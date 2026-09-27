# Research: Preview Render Speed, and Python Workers vs. JS Workers

Research note, not a decision record — no decision has been made on either question. Findings are cited against primary sources where a primary source exists; where it doesn't, that's stated explicitly rather than filled in with secondhand claims.

Date: 2026-09-25.

## Scope

This project uses "Render" and "Render on server" as two distinct, precisely-defined terms (see `CONTEXT.md`):

- **Render** (client-side): the customer-facing Customize view's live preview. Runs entirely in the end user's own browser, via `openscad-wasm` in a Web Worker (`src/worker/render.worker.ts`, orchestrated by `src/state/useRenderMesh.ts`). This is what a customer sees update as they drag a slider. It uses the CGAL backend.
- **Render on server**: an Admin-only action that triggers a *server-side* Render — native OpenSCAD in a Cloudflare Container, via the async Export Job pipeline (`render-worker/`), on the Manifold backend. Not used by customers at all; used by the Admin to preview a draft or check parity with the client engine.

"Preview render" in the user's question is confirmed, by reading the code, to mean the **client-side engine** — the thing every customer's browser runs on every Configuration change. Question 1 below is about that path. It also covers the server-side path's speed profile briefly, since ADR-0006/ADR-0007 already treat it as the "known-fast" reference point the client-side engine is compared against.

Primary files read to confirm this framing: `CONTEXT.md` (Render, Mesh, Export Job, Render on server entries), `docs/adr/0001-always-render-exact-geometry.md`, `docs/adr/0004-hybrid-client-and-server-rendering.md`, `docs/adr/0005-async-export-job-pipeline.md`, `docs/adr/0006-manifold-backend-for-server-side-render.md`, `docs/adr/0007-skip-then-server-fallback-for-expensive-preview.md`, `src/worker/render.worker.ts`, `src/state/useRenderMesh.ts`, `render-worker/src/index.ts`, `render-worker/container/server.js`, `functions/api/admin/render.ts`, `functions/lib/jobs.ts`, `README.md`.

---

## Q1: Making preview render fast

### What the current implementation actually does

`src/worker/render.worker.ts` spins up a **brand-new `openscad-wasm` instance on every single render** (`createInstance()`, called fresh inside `self.onmessage`). Nothing is cached except the already-fetched glue-script/wasm bytes (browser HTTP cache + the `wasmModule` module-scope variable in the vendored `public/openscad/openscad.js`, which caches the fetched `.wasm.js` text as a data URL but still re-imports it with a `#${Math.random()}` cache-buster on every call — i.e. it avoids a second network fetch, not a second module evaluation). Each render therefore pays:

1. A fresh `import()` + module evaluation of the Emscripten glue code (`openscad.js` → `openscad.wasm.js`), which re-runs Emscripten's module bootstrap.
2. Re-adding fonts (`addFonts`, plus this project's two extra Thai `.ttf` files fetched and written into the fresh instance's FS via `instance.FS.writeFile`) on every instance.
3. A full CGAL CSG evaluation of the whole `.scad` source via `callMain()`.

The code comment in `render.worker.ts` (lines 36-43) and the mirrored explanation in `README.md` assert that this is required because "openscad-wasm's internal (C++-side) global state isn't safe to reuse across `callMain()` calls." I checked this against Emscripten's own project, not just the ADR's word:

- Emscripten maintainer Alon Zakai ("kripken"), in [emscripten-core/emscripten#14367 — "Assert on calling main more than once"](https://github.com/emscripten-core/emscripten/pull/14367): "If `callMain` is called more than once, bad things can happen, such as the stack allocation of argv perhaps overflowing, or issues with the runtime initialization/shutdown." He also notes it's "simply not valid to call main multiple times" in C generally. The PR was **not merged** — Emscripten deliberately does not hard-block a second call, because some advanced users get away with it if their program has no problematic global constructors/destructors/state. That's a real caveat: it's not flatly impossible, it's unsafe-by-default and program-dependent.
- OpenSCAD's own C++ codebase is exactly the kind of program with heavy global state (CGAL kernels, the parser's global symbol tables, geometry caches) that this caveat is about — so treating a second `callMain()` on the same instance as unsafe is a reasonable, conservative reading, not a fabricated claim. I could not find an OpenSCAD-wasm-specific upstream issue that reproduces the exact crash this project's comment describes ("raw wasm exception pointer instead of a message") — I searched `openscad/openscad-wasm`'s issues/PRs via `gh api` and found none discussing instance reuse directly. So: the general Emscripten mechanism is confirmed from a primary source; the specific claim that openscad-wasm crashes in exactly this way is this project's own tested finding, not something I could independently verify against an upstream report. Worth being explicit about that gap rather than presenting it as externally confirmed.
- Separately, [openscad/openscad-wasm#19 — "Performance more than 6X slower than native CLI"](https://github.com/openscad/openscad-wasm/issues/19) is directly relevant: a user measured 53.4s (WASM) vs 8.6s (native CLI) for the same model — roughly the same order of slowdown this project's own ADR-0006 numbers imply (90.1s CGAL vs 0.47s Manifold is a different comparison, but points the same direction: native/optimized-backend >> browser WASM/CGAL). A follow-up comment in that same issue is worth flagging because it's a plausible trap for this codebase too: the reporter's *actual* bug turned out to be not using a Web Worker at all — "as soon as I changed to using a web worker the render was near instant." This project already renders inside a Worker (`render.worker.ts`), so that particular footgun doesn't apply here, but it's a useful sanity check that the Worker usage itself isn't wasted effort.

### Debounce / scheduling in `useRenderMesh.ts`

- `DEBOUNCE_MS = 400` — every Configuration change (slider drag, etc.) waits 400ms of quiet before a render is even requested.
- `RENDER_TIMEOUT_MS = 60_000` — because `callMain()` runs synchronously inside the Worker's message loop, a pathological model can't be interrupted except by terminating the whole Worker; a 60s render is killed and a fresh Worker spawned.
- An in-memory LRU-ish cache (`MAX_CACHE_ENTRIES = 10`, keyed by `source + defines`) skips re-rendering entirely for a (source, defines) pair already seen this session — cheap protection against flip-flopping a checkbox or undoing a slider drag.
- If a new request arrives while a render is still in flight, the Worker is **terminated and replaced** rather than queued (comment at lines 178-186) — because a blocked Worker can't even receive the new message. This means a user who changes a parameter mid-render always pays a fresh Worker-spawn + instance-creation cost, not just a fresh `callMain()`.

Room to tune, specific to this file:
- 400ms is a fixed, one-size-fits-all debounce. There's no attempt in the code to raise the debounce for templates already known to be slow (e.g. anything with `estimateComplexity`'s `hasExpensiveLoop`, `src/customizer/estimateComplexity.ts`) versus lowering it for trivial templates. A longer debounce for flagged-expensive templates would reduce wasted in-flight-render terminations without changing anything for fast templates.
- Because an in-flight render is killed (not queued) on a new change, rapid-fire slider drags on anything non-trivial can end up doing strictly wasted work (instance spun up, evaluation partially run, then thrown away) more than once per interaction. This is a direct consequence of openscad-wasm's synchronous `callMain()` and the one-instance-per-render design — not something the debounce value alone can fix.
- The STL round-trip (`instance.FS.readFile` → `ArrayBuffer` → `postMessage` with transfer → `STLLoader().parse()` on the main thread) is not the bottleneck relative to the CSG evaluation itself, but it's also not free; no evidence was needed beyond reading the code that the CSG evaluation (`callMain`) dominates wall time for anything nontrivial, consistent with the 90s-CGAL number in ADR-0006 and the 53s number in openscad-wasm#19.

### Faster backend / flags in the WASM build

I checked the actual vendored binary in this repo, `public/openscad/openscad.wasm` (7.7MB), rather than trusting the ADR's claim secondhand:

```
strings public/openscad/openscad.wasm | grep -i manifold
```
returns only "non-manifold mesh" / "2-manifold" geometry-validity strings (CGAL's own terminology for a mesh being topologically manifold) — **no `--backend=manifold` or `--enable=manifold` string is present**, and no reference to the Manifold library. This directly confirms CONTEXT.md/ADR-0006's claim that the vendored build predates Manifold's integration into OpenSCAD, the same technique an earlier session in this project used to confirm the absence of 3MF export (`strings ... | grep 3mf` → "Export to 3MF format was not enabled when building the application.", also reconfirmed here).

However — and this is a finding the ADRs don't currently reflect — **upstream `openscad/openscad-wasm`'s current (unreleased) source already documents the Manifold flag** in its own `README.md`, in the exact usage example:
```js
instance.callMain(["/input.scad", "--enable=manifold", "-o", filename]); // manifold is faster at rendering
```
([openscad/openscad-wasm README](https://github.com/openscad/openscad-wasm/blob/main/README.md)). The repo has had ongoing activity (`pushed_at: 2026-08-02`, per `gh api repos/openscad/openscad-wasm`) — open PRs like [#31 "Add `CGAL_ALWAYS_ROUND_TO_NEAREST`..."](https://github.com/openscad/openscad-wasm/pull/31) and [#36 "Add Windows build support... and fix CGAL mesh errors"](https://github.com/openscad/openscad-wasm/pull/36) — even though it hasn't cut a tagged **release** since `2022.03.20` (`gh api repos/openscad/openscad-wasm/releases` lists only 2019/2022.02.18/2022.03.13/2022.03.20). And separately, [`openscad/openscad-playground`](https://github.com/openscad/openscad-playground) — a different official OpenSCAD web project — already ships a WASM build that "defaults to the Manifold backend so it's super fast," built from the same upstream `DSchroer`-derived WASM toolchain.

This means ADR-0007's framing ("no official Manifold-enabled `openscad-wasm` build exists to swap in") is **slightly stale as of today** — `openscad-playground`'s build is evidence that a Manifold-capable WASM build of OpenSCAD is achievable and has in fact been built by someone else in the OpenSCAD org, not just theorized. It is *not* evidence that adopting it here is trivial:
- This project vendors specific, patched artifacts (`public/openscad/openscad.js`, `openscad.fonts.js`, plus the two extra Thai `.ttf` fonts loaded via `EXTRA_FONTS` in `render.worker.ts`) that would need to be re-integrated with whatever `openscad-playground` or a fresh `openscad-wasm` build produces.
- The `--enable=manifold` flag shown in the current openscad-wasm README is described by ADR-0006's own container-side comment as "the older... spelling from Manifold's early 'experimental' days [that] is obsolete and silently falls back to CGAL instead of erroring" on the *native nightly* build this project already uses server-side. Whether that flag is still meaningful (vs. `--backend=manifold`) on whatever OpenSCAD source revision the current openscad-wasm build compiles against needs to be verified directly against a freshly built binary — I could not verify this without actually building it, which is out of scope for a research note.
- No published, versioned release of a Manifold-enabled `openscad-wasm` exists to just download; someone would still need to build it (Docker + Make + Deno, per the openscad-wasm README's own build instructions) and take on ongoing maintenance, exactly as ADR-0006/ADR-0007 already anticipated. What's new is that the *feasibility* case is stronger than "no official build exists at all" — `openscad-playground` is a working existence proof from within the same GitHub org.

### Emscripten/WASM cold-start techniques

Primary/near-primary sources checked:
- [web.dev — "WebAssembly performance patterns for web apps"](https://web.dev/articles/webassembly-performance-patterns-for-web-apps): recommends `WebAssembly.instantiateStreaming()`/`compileStreaming()` over the non-streaming variants, and recommends doing the Wasm fetch/compile work once and reusing a long-lived Worker so the *compiled* module can be cached and only re-instantiated (not re-compiled) per use. This project's `render.worker.ts` doesn't call `WebAssembly.instantiateStreaming` directly — it goes through the vendored Emscripten glue (`openscad.js`/`openscad.wasm.js`), whose own instantiation strategy wasn't independently audited here (it's a generated/vendored artifact, not authored in this repo).
- Emscripten's own [Module API docs](https://emscripten.org/docs/api_reference/module.html) confirm `noInitialRun` (used here) suppresses the automatic `main()` call so the caller can invoke `callMain()` explicitly later — but the docs say nothing about whether re-using a `Module`/instance across multiple `callMain()` calls is supported, which is consistent with the earlier point: this is genuinely an unspecified/unsafe area of the Emscripten API, not something with an official "yes, reuse is fine" answer to fall back on.
- The generic pattern from serverless-WASM research (e.g. a two-tier raw-binary + compiled-module cache, "warm" invocations paying only compile cost and "hot" invocations paying neither) matches what the current code already gets for free at the *fetch* layer (browser HTTP cache for the `.wasm` binary) but not at the *compiled-module* or *instance* layer, since a fresh `import()` re-runs Emscripten's bootstrap every render.

Concretely, for this codebase, the deferred/plausible techniques are:
- **Warm-instance pooling in the Worker**, if and only if the reuse-safety question above is resolved (e.g. by confirming empirically, or from an upstream fix, that a fresh `callMain()` on an existing instance is safe for OpenSCAD specifically) — this is the single highest-leverage change since it would remove the "re-run Emscripten's whole module bootstrap + re-add fonts" cost on every render, not just the CSG evaluation cost.
- **Explicit `WebAssembly.instantiateStreaming`** if/when this project ever builds its own openscad-wasm bundle (rather than using the vendored glue) — not actionable against the current vendored artifact without rebuilding it.
- None of this changes the CSG evaluation cost itself, which appears to be the dominant cost for any nontrivial template per the 53s/90s numbers above — a Manifold-enabled WASM build (see above) is the only lever found in this research that plausibly addresses *that* specific cost, not just instantiation overhead.

### Incremental / partial re-render

OpenSCAD's own documentation and source were checked for whether a Configuration change (e.g. one slider parameter) can trigger anything short of a full CSG tree re-evaluation:
- The [OpenSCAD User Manual's CSG Modelling page](https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/CSG_Modelling) documents that `render()` "always calculates the CSG model for this tree (even in OpenCSG preview mode)" and warns this "can make previewing very slow." It does not document any subtree-level caching that would survive a parameter change (a changed variable can affect any node in the tree, including ones textually far from the changed variable, because OpenSCAD's evaluation model resolves variables at evaluation time, not by pre-partitioning the tree by dependency).
- OpenSCAD contributor Olivier Chafik's write-up, [ochafik.com — "OpenSCAD 3D rendering just got an order of magnitude faster"](https://ochafik.com/jekyll/update/2022/02/09/openscad-fast-csg-contibution.html), which documents the actual performance work behind OpenSCAD's fast-CSG contribution (predecessor to Manifold's later integration), attributes the speedup to faster boolean-op algorithms (CGAL corefinement instead of Nef polyhedra) and CSG tree flattening/rewriting — not to incremental/partial re-evaluation across separate renders. This is a first-party-adjacent source (an OpenSCAD core contributor's own account of the work) but not `openscad.org` itself; treat it as strong secondary evidence, not an official doc.
- I found no primary source — not `openscad.org`, not the OpenSCAD GitHub wiki, not Emscripten's docs — describing a supported mechanism for incremental re-render keyed off which parameters changed. Given how OpenSCAD's language model works (arbitrary imperative-ish evaluation of `.scad` source with variables substitutable anywhere), building dependency-aware partial re-evaluation would be a change to OpenSCAD's own evaluator, not something achievable from this project's side at all. **This should be read as "no evidence found that this is possible today," not as a confirmed impossibility** — I did not find an authoritative statement from the OpenSCAD project explicitly ruling it out either.

### Recommendations specific to this codebase

1. **Don't change the debounce value speculatively.** 400ms (`src/state/useRenderMesh.ts:8`) is already reasonable for typical slider interaction; the actual cost is dominated by `callMain()`'s CSG evaluation and, secondarily, by re-running Emscripten's module bootstrap per render — not by the debounce window.
2. **The highest-leverage, lowest-risk change available today is not code — it's re-evaluating ADR-0007's "no official Manifold-enabled build exists" premise** against `openscad-playground`'s existing build and upstream `openscad-wasm`'s current README (`--enable=manifold` is now documented there), since that premise is what deferred the Manifold-in-WASM investigation. This doesn't mean adopting it now — it means the "separate, larger investment" ADR-0007 deferred may be smaller than assumed when it was written, and worth a fresh look, not a rebuild-from-scratch exercise.
3. **Instance-reuse/warm-pooling in `render.worker.ts` is real but currently blocked on an unresolved safety question**, not a known-safe optimization being left on the table. Before attempting it, this project would need either (a) empirical testing of whether a second `callMain()` on the same instance is actually safe for OpenSCAD's specific global-state footprint (the Emscripten PR discussion suggests it depends entirely on the program, and nobody has published that specific verdict for OpenSCAD), or (b) an upstream fix to make instances properly reset-able. Absent that, "kill and respawn a fresh Worker" (already what the code does on a superseding request) is the safe fallback, and is already implemented.
4. **No incremental/partial-CSG-reuse path was found** in OpenSCAD's own docs/source discussion; treat "always full re-evaluation" as the working assumption unless a future OpenSCAD release documents otherwise (worth periodically re-checking `openscad.org`'s own docs and changelog, since Manifold's rapid recent development is exactly the kind of thing that could change this).

---

## Q2: Python Workers instead of JS Workers

This is interpreted, per the task, as: could **Cloudflare Python Workers** (Python-on-Workers, [developers.cloudflare.com/workers/languages/python/](https://developers.cloudflare.com/workers/languages/python/)) replace `render-worker/` — the standalone TypeScript Worker that consumes the `render-jobs` Queue, drives a `RenderContainer` (via `@cloudflare/containers`), reads/writes D1 (`export_jobs`), and writes results to R2 — not the interactive preview, which has no server-side "Worker" component to swap at all (it's browser-only, per Q1's scope section).

### Current release status

Cloudflare Python Workers reached **General Availability on 2026-09-21** (four days before this research), per [Cloudflare's own blog post, "Python Workers are now generally available"](https://blog.cloudflare.com/python-workers-ga/) and independently corroborated by third-party coverage the same week (e.g. [Simon Willison's write-up](https://simonwillison.net/2026/Sep/21/cloudflare-python-worker/)). It's no longer beta. The GA announcement specifically calls out removing "the JavaScript conversion layer" from the two-year-long beta, native `workers.asgi`/`workers.wsgi` connectors for FastAPI/Django/Flask, and bindings usable "in a Pythonic way without writing a single line of JavaScript code."

### Does it support Queue consumers?

**Yes**, and this is directly confirmed by an official example, not just a docs mention. Cloudflare's own [`cloudflare/python-workers-examples`](https://github.com/cloudflare/python-workers-examples) repo (currently ~30 example projects, actively covering D1, R2, Durable Objects, Workflows, Hyperdrive, Vectorize, and more) includes `image-redraw`, whose entrypoint defines:
```python
async def queue(self, batch, env, ctx):
```
as a method on a `WorkerEntrypoint`-derived class — the direct Python equivalent of this project's `render-worker/src/index.ts`:
```ts
async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> { ... }
```
The blog's own bindings list ("Workers AI, R2, D1, Hyperdrive, Durable Objects, Queues, Workflows") explicitly includes Queues. So the Queue-consumer half of `render-worker/`'s job is a straightforward, officially-supported Python port.

### Does it support the Containers binding?

**No supporting evidence found, and several signals point the other way.** This matters a lot here because `RenderContainer` (`render-worker/src/index.ts`) is a Durable-Object-backed `Container` from `@cloudflare/containers` — an npm package, imported as TypeScript/JavaScript (`import { Container, getRandom } from "@cloudflare/containers"`) — and it's the thing that actually drives native OpenSCAD:
- Neither the [Python Workers docs](https://developers.cloudflare.com/workers/languages/python/) nor the [Python Workers GA blog post](https://blog.cloudflare.com/python-workers-ga/) mention Containers anywhere in their bindings lists, despite both explicitly enumerating Queues, D1, R2, Durable Objects, Workflows, and Hyperdrive.
- The [Cloudflare Containers docs](https://developers.cloudflare.com/containers/) and [get-started guide](https://developers.cloudflare.com/containers/get-started/) show only TypeScript/JavaScript examples of the `Container` class and don't mention a Python alternative.
- Cloudflare's own `python-workers-examples` repo — which does have dedicated examples for essentially every other binding type — has **no `containers` example**, despite the repo being actively maintained through GA. Given how thorough that repo otherwise is, this absence is meaningful circumstantial evidence, though it isn't a documented "not supported" statement.
- Durable Objects themselves **are** supported from Python Workers (per the [2025-05-14 changelog entry, "Durable Objects are now supported in Python Workers"](https://developers.cloudflare.com/changelog/post/2025-05-14-python-worker-durable-object/)), so the gap isn't "Python Workers can't do Durable Objects" — it's specifically that the `Container`-extends-`DurableObject` pattern from `@cloudflare/containers` has no documented Python counterpart.

I could not find an explicit Cloudflare statement saying "Containers are JS/TS-only" — so this should be read as **strong absence-of-evidence, not a confirmed hard limitation** as of 2026-09-25. It's the single biggest open question a decision here would hinge on, and it's worth a direct check against Cloudflare's docs/changelog again before committing either way, since GA was only days ago and this is exactly the kind of gap that gets filled in fast.

### Does it support D1 and R2?

**Yes**, both are explicitly listed in both the docs and the GA blog's bindings list, alongside Queues and Durable Objects. `render-worker/`'s D1 usage (`export_jobs` table reads/writes) and R2 usage (`THUMBNAILS.put(...)`) both have a direct Python equivalent per Cloudflare's own materials.

### Constraints that would matter for this specific pipeline

- **Memory**: 128MB per isolate — per [Cloudflare's Workers limits docs](https://developers.cloudflare.com/workers/platform/limits/), this is the standard per-isolate memory ceiling for **all** Workers (JS/TS and Python alike), not a Python-specific extra restriction. It matters here only insofar as it already constrains anything running inside the Worker isolate itself — but `render-worker/`'s actual heavy lifting (the OpenSCAD CLI invocation) happens inside the *Container*, a separate compute environment with its own resource limits, not inside the Worker isolate. So this limit is largely irrelevant to a TS-vs-Python choice for this specific Worker, since neither language's Worker-isolate code does the rendering itself.
- **CPU time**: standard Workers CPU-time limits (10ms free plan / up to 5 minutes paid plan configurable, default 30s, per the same limits doc) apply to Worker-isolate code, not Container execution — `render-worker/`'s actual render call already goes through `container.fetch(...)`, an outbound HTTP call from the Worker to the Container, which isn't bound by the Worker's own CPU-time budget the same way. Not a differentiator between languages.
- **Packages**: Python Workers run on Pyodide and, per the GA blog, now support "any package supported by Pyodide, including pure Python packages... and many packages that rely on dynamic libraries," with Cloudflare "actively working with major package maintainers to add PyEmscripten builds" (referencing PEP 783). This is a meaningfully expanded package story versus the earlier beta, but it's irrelevant to `render-worker/`'s actual job, which is orchestration (read a D1 row, call a Container over HTTP, write bytes to R2) — it needs no scientific/geometry Python package at all, since OpenSCAD itself does the geometry work, in a separate Container, in C++.
- **No confirmed Container support** (see above) is the constraint that actually matters for this codebase, since without it, a Python `render-worker/` couldn't drive `RenderContainer` at all and the whole pipeline's actual rendering step would have nowhere to run.

### Steelmanning "why would you even want Python here"

Two distinct ideas are worth separating, since the task's framing conflates them:

1. **Python Workers as a drop-in language swap for the existing orchestration Worker** (same architecture: Queue consumer → Container → D1/R2). Given openscad-wasm and native OpenSCAD are both non-Python (WASM/C++ and a CLI binary respectively), there's no computational reason to prefer Python for this — the Worker itself does no geometry work; it shuttles a job ID through D1 lookups, an HTTP call, and an R2 write. This is exactly the kind of thin-glue code where language choice is close to a wash technically, and the practical blocker is the unresolved Container-binding question above.
2. **Replacing native-OpenSCAD-in-a-Container with a pure-Python geometry stack** (e.g. `numpy-stl`, `trimesh`) instead of shelling out to the `openscad` CLI. This is a fundamentally different, much larger proposal than "swap the Worker's language," and it doesn't hold up well against what ADR-0004/0005/0006 already established:
   - `trimesh`/`numpy-stl` are mesh-manipulation libraries — they can load, transform, boolean-op (with varying robustness), and export meshes, but neither is an OpenSCAD-language interpreter. They have no `.scad` parser, no Customizer support, no CSG-tree evaluator matching OpenSCAD's own semantics. Adopting one would mean re-implementing (or finding some other way to execute) the actual `.scad` → geometry evaluation this whole project is built around — an enormously larger undertaking than anything in scope here, and one that would break this project's core promise (CONTEXT.md's Template definition: "a parametric OpenSCAD design... that the Customize view turns into an editable Mesh," authored in real OpenSCAD syntax by the Admin).
   - ADR-0006 already picked native OpenSCAD + the Manifold backend specifically *because* it's dramatically faster than the alternative it was compared against (CGAL: 90.1s → Manifold: 0.47s on the measured template) while staying byte-for-language compatible with what Admins actually author. A Python geometry stack wouldn't be evaluating `.scad` source at all, so it isn't a comparable alternative — it's a different product decision (stop being an OpenSCAD Customizer tool), not a backend swap.
   - I found no primary source (Cloudflare, OpenSCAD, or otherwise) suggesting Python geometry libraries are used as an OpenSCAD replacement anywhere in production; this idea doesn't appear to have real precedent to point to, primary or otherwise.

### Recommendation

**Do not switch `render-worker/` from TypeScript to Python Workers**, on the evidence gathered here:

- The parts of the job Python Workers clearly support today — Queue consumption, D1, R2 — are a lateral move at best; `render-worker/src/index.ts` is ~130 lines of orchestration glue with no computational or ecosystem reason to prefer Python (see steelman #1 above).
- The part that matters most — driving `RenderContainer` via the `Container`/Durable Object pattern — has **no confirmed Python support** as of Python Workers' 2026-09-21 GA. Every official source checked (docs, GA blog post, the extensive official examples repo) is silent on Containers for Python, in contrast to how explicitly they cover Queues/D1/R2/Durable Objects/Workflows. Migrating would risk landing on unsupported ground for the one piece of `render-worker/` that can't be worked around.
- Rewriting `render-worker/` in Python would be pure migration risk (re-verify D1/R2/Queue semantics, re-test the Container binding path, redo the `wrangler.toml` config) for no identified upside — no performance, capability, or maintainability gain was found that TypeScript doesn't already provide for this specific, small, IO-orchestration Worker.
- If the real motivation is "we want more Python in this stack" for some other reason (team preference, future features), that's a legitimate but separate conversation from this Worker specifically — and even then, the Container-binding gap should be closed (or explicitly confirmed closed) before committing to it for `render-worker/`.

Given Python Workers just reached GA days before this research, this is a fast-moving area — the Containers-binding gap in particular is worth rechecking against Cloudflare's docs/changelog periodically, since it's the one blocking finding here that's most likely to change on short notice.

---

## Sources consulted

- [emscripten-core/emscripten PR #14367 — "Assert on calling main more than once"](https://github.com/emscripten-core/emscripten/pull/14367)
- [emscripten-core/emscripten Module API reference](https://emscripten.org/docs/api_reference/module.html)
- [openscad/openscad-wasm — repository](https://github.com/openscad/openscad-wasm), [README.md](https://github.com/openscad/openscad-wasm/blob/main/README.md), [issue #19 — "Performance more than 6X slower than native CLI"](https://github.com/openscad/openscad-wasm/issues/19), [PR #31](https://github.com/openscad/openscad-wasm/pull/31), [PR #36](https://github.com/openscad/openscad-wasm/pull/36)
- [openscad/openscad-playground — repository](https://github.com/openscad/openscad-playground)
- [OpenSCAD User Manual — CSG Modelling](https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/CSG_Modelling)
- [Olivier Chafik — "OpenSCAD 3D rendering just got an order of magnitude faster"](https://ochafik.com/jekyll/update/2022/02/09/openscad-fast-csg-contibution.html) (OpenSCAD core-contributor account, not an official openscad.org doc)
- [web.dev — "WebAssembly performance patterns for web apps"](https://web.dev/articles/webassembly-performance-patterns-for-web-apps)
- [Cloudflare — Python Workers docs](https://developers.cloudflare.com/workers/languages/python/)
- [Cloudflare Blog — "Python Workers are now generally available"](https://blog.cloudflare.com/python-workers-ga/)
- [cloudflare/python-workers-examples — repository](https://github.com/cloudflare/python-workers-examples), specifically `image-redraw`'s `queue()` handler
- [Cloudflare Changelog — "Durable Objects are now supported in Python Workers" (2025-05-14)](https://developers.cloudflare.com/changelog/post/2025-05-14-python-worker-durable-object/)
- [Cloudflare — Containers docs](https://developers.cloudflare.com/containers/), [get-started guide](https://developers.cloudflare.com/containers/get-started/)
- [Cloudflare — Workers platform limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Simon Willison — "Cloudflare Python Workers are now generally available"](https://simonwillison.net/2026/Sep/21/cloudflare-python-worker/) (third-party corroboration of the GA date only)

This project's own code, read directly rather than assumed from the ADRs: `CONTEXT.md`, `docs/adr/0001`–`0007`, `src/worker/render.worker.ts`, `src/state/useRenderMesh.ts`, `render-worker/src/index.ts`, `render-worker/container/server.js`, `render-worker/wrangler.toml`, `render-worker/package.json`, `functions/api/admin/render.ts`, `functions/lib/jobs.ts`, `README.md`, and `public/openscad/openscad.wasm` (inspected directly via `strings` for `manifold`/`3mf` support).
