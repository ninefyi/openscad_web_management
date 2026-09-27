# Research: Why Is MakerWorld's "Parametric Model Maker" Fast?

Research note, not a decision record — no decision has been made based on this. Findings are cited against primary sources (official Bambu Lab material) and direct observation (MakerWorld's own shipped client code and network behavior) where possible; anything inferred rather than confirmed is labeled as such explicitly.

Date: 2026-09-26.

## Scope

The question: why does [makerworld.com/en/makerlab/parametricModelMaker?pageType=generator](https://makerworld.com/en/makerlab/parametricModelMaker?pageType=generator) — Bambu Lab's browser-based OpenSCAD customizer — feel fast, and does it use any technique this project (`sukjab_scad`) hasn't already considered? This follows on from `docs/research/preview-render-speed-and-python-workers.md` and ADR-0010 (cached default Configuration), ADR-0011 (client-side Manifold backend), and ADR-0012 (removed the skip-then-server-fallback gate), which is the state this project's own client-side "Render" path is in as of this writing.

**Methodology and a hard limitation up front:** the generator page itself (`/en/makerlab/parametricModelMaker?pageType=generator`) redirects unauthenticated visitors straight to a MakerWorld/Bambu Lab sign-in page — confirmed by navigating there directly with a browser tool (landed on `https://makerworld.com/en/sign-in/service?cb=...`). A specific model's "Customize" flow (tried via [the Parametric Electronics Panel Generator model page](https://makerworld.com/en/models/3082544-parametric-electronics-panel-generator-openscad)) also gates on a "Sign up to unlock a world of possibilities" modal the moment the Customize button is clicked. Per this session's operating rules, creating an account or logging in is not something to do unilaterally, so **the actual "Generate" click and its live network traffic could not be observed** — no first-hand render-time measurement exists in this note. Everything below is either (a) read directly out of MakerWorld's own shipped JavaScript (loaded by simply visiting the public, unauthenticated model page, which prefetches the customizer's bundle), which is about as close to primary-source-from-the-outside as external inspection gets, or (b) sourced from Bambu Lab's own release notes/forum posts (also first-party), with third-party commentary called out as such.

---

## What was directly observed

### 1. The generator UI is gated; the model page is not, and it prefetches the customizer

Loading `https://makerworld.com/en/models/3082544-parametric-electronics-panel-generator-openscad` (no login) eagerly fetches, among ~130 requests: `wasm_exec.js`, a chunk literally named `openscad-2bdbe03757813e7f.js`, `three-4150568e947d90b6.js` (Three.js), `jszip-*.js`, `image-processing-*.js`, and `pages/makerlab/parametricModelMaker-a73f89490cc53e50.js` — i.e. the whole Parametric Model Maker bundle is prefetched from the model's own page, before any interaction. This is browser network-tab observation, not documentation.

`wasm_exec.js` is Go's WebAssembly runtime glue (not Emscripten's, which is what `openscad-wasm` and this project's vendored `public/openscad/openscad.js` use). This looked at first like it might mean MakerWorld runs a Go-compiled WASM module client-side. **That hypothesis turned out not to be supported by the rest of the evidence** (see below): no `.wasm` file was ever fetched while the model page and its prefetched bundle loaded, and grepping the `openscad-*.js` and related chunk sources found no `callMain`, no `new Worker(...)` for OpenSCAD, and no CGAL/Manifold/WASM instantiation code path in the customizer-specific bundles. `wasm_exec.js` is loaded on ordinary page navigation across the site generally (it was also present in the very first login-page network trace, unrelated to any customizer). Best read: **it's used for something else on the page (unidentified — possibly image/QR/captcha-related), not for running OpenSCAD.** This is stated as an open question, not a finding.

### 2. The actual OpenSCAD execution is server-side, via an async job + polling API — not local WASM

This is the core finding, and it's the most solidly sourced one: reading `https://makerworld.com/_next/static/chunks/96907-8414615a20b5084d.js` (fetched directly with `fetch()` from the browser console while on the public model page, then searched as plain text — reproducible by any browser dev tools) shows the literal client-side functions that drive generation:

```
C = "--backend=manifold\n--enable=fast-csg\n--enable=textmetrics\n--enable=roof\n--colorscheme=AllWhite"
```

This is the OpenSCAD CLI flag string MakerWorld prepends to every generation request (confirmed via `r=C+r` in both the "preview" function `U` and the "download-stl" function `M` in that chunk). **MakerWorld uses OpenSCAD's Manifold backend** — the same backend ADR-0011 in this project just switched the client-side preview to, and the same one ADR-0006 already uses server-side. It is not using CGAL. (`--enable=fast-csg` is additionally set; this project's own ADR-0006 container comment already documents this flag as an older/obsolete spelling that silently falls back to CGAL on the native nightly build this project uses server-side, so it isn't clear whether it's doing anything on MakerWorld's build beyond `--backend=manifold` — not independently verifiable from outside.)

The generation call itself, function `N` in that chunk (lightly reformatted, names from the minified source: `N`, `a.lx`, `a.Qw`):

```js
N = async ({source, params, type, id, designId, isProtected, pollingController}) => {
  const code = base64(source);
  if (sizeOf(code) > 1024 /* KB */) throw { error: "Source too large: ...KB, max allowed: 1024KB" };

  const job = await a.lx({ code, params: base64(params), type, color: "#ffffff", designId, ... });

  let result = null;
  if (job.objList?.length > 0 || job.objUrl) {
    result = job;                       // fast path: server already had the result
  } else {
    for (let y = 0; y < 15; y++) {      // poll up to 15 times
      if (pollingController?.cancelled) throw { error: "cancelled" };
      const status = await a.Qw({ id: job.id });
      if (status.status === "success") { result = status; break; }
      if (status.status === "timeout") throw { error: "timeout" };
      if (status.status === "failed")  throw { code: status.code, error: status.errMsg };
      await sleep(2000);                // 2-second poll interval
    }
    if (!result) throw { error: "timeout" };  // ~30s hard cap (15 × 2s)
  }
  ...
};
```

Confirmed details from this same code:
- **Async job submission + polling, capped at ~30 seconds** (15 polls × 2s) before the client gives up and shows a timeout error. This matches a UI string found in the same bundle family (`openscad-2bdbe03757813e7f.js`): `timeout_error: "请求超时，请简化源码或尝试重试。"` ("Request timed out, please simplify your source code or try again.") — note "请求" (request), not "渲染" (render), consistent with this being a network-request timeout, not a local computation timeout.
- **A "fast path"**: if the initial submission response already contains `objList`/`objUrl`, no polling round-trip happens at all — the server evidently can, and often does, finish the render before the client's first status check is even needed. This is consistent with what this project's own ADR-0006 already established from direct measurement: a native Manifold-backend OpenSCAD render is dramatically faster than a browser WASM/CGAL one (ADR-0006 measured ~0.47s native Manifold vs. ~90.1s CGAL-in-WASM for the same model). MakerWorld's architecture is exactly the shape that pays off if the underlying render really is sub-second server-side: submit, and usually already have the answer.
- **`.scad` source size cap: 1024 KB (1 MB)**, enforced client-side before submission.
- **Preview requests generate `type: "obj"`** (Wavefront OBJ + MTL, loaded into the Three.js viewer already confirmed present in the bundle) — a separate, lighter-weight output than the final export.
- **The final STL export appends `--export-format=binstl`** — i.e. MakerWorld already exports **binary** STL, not ASCII. This project's most recent commit (`15877b0`, "Export STL as binary, not OpenSCAD's default ASCII") independently arrived at the same choice; this is corroborating evidence that it's the right call, not a new idea to adopt.
- A `PollingController` class (in the same chunk) manages polling keys with cleanup timers and `cancelPreviousPollingByType`, so a new preview/export request cancels a stale in-flight poll for the same type — conceptually similar to this project's `render.worker.ts` terminating a superseded in-flight render (per the existing research note), except MakerWorld's "in-flight work" being cancelled is a poll against a server job, not a local WASM computation.

**This directly answers "is geometry computed client-side or server-side": server-side**, based on this code-level evidence (not an official architecture statement — inferred from reading MakerWorld's own shipped JS, but about as close to certain as external inspection gets, since the code literally builds an HTTP submission payload, polls a status endpoint by job id, and only then fetches a result URL for the OBJ/STL/3MF blob). The literal endpoint paths (`a.lx`, `a.Qw`) resolve through a shared API-client module not present in this chunk, so the exact REST route strings weren't recovered — a gap, not a contradiction.

### 3. Generation is explicitly user-triggered, not live-per-slider-tick

A UI string in `openscad-2bdbe03757813e7f.js`: `update_model_tip: "参数已经被修改，请点击生成按键应用修改。"` ("Parameters have been modified, please click the Generate button to apply the change.") This confirms — from MakerWorld's own UI copy — that **changing a parameter does not trigger an automatic re-render**. The user must explicitly click "Generate." This is a materially different interaction model from this project's customer-facing Customize view, where every Configuration change (after a 400ms debounce) triggers an automatic client-side render (`src/state/useRenderMesh.ts`). MakerWorld sidesteps the "rapid slider drag fires N wasted renders" problem entirely by never firing on drag at all — it batches an arbitrary number of parameter edits into one explicit, user-paced request. This is a UX/workload-shaping choice, not a rendering-engine optimization, and it's one this project hasn't discussed in the prior research note or ADRs 0010–0012 (which focus entirely on making the automatic-on-every-change render faster or cachable, not on removing the automatic trigger).

### 4. Error copy also implies server involvement generally

Same bundle: `common_error: "服务器开小差了，请稍后重试。"` ("The server got distracted, please try again later.") and `too_many_requests: "请求过于频繁，请稍后重试。"` ("Requests too frequent, please try again later.") — an explicit server-side rate-limit-style error message. Consistent with #2 above; listed separately because it's independent evidence (different string, different part of the bundle) pointing the same direction.

### 5. Infrastructure: MakerWorld itself runs behind Cloudflare

`fetch()` against MakerWorld's own static JS chunk (`openscad-2bdbe03757813e7f.js`) returned response headers including `server: cloudflare`, `cf-cache-status: HIT`, `cf-ray: ...`, and `cache-control: public, max-age=31536000, immutable`. This confirms MakerWorld's static assets sit behind Cloudflare's CDN with standard immutable-asset caching (a year-long max-age plus a content-hashed filename, which is just normal Next.js build output — not a novel technique). This says nothing about where the actual OpenSCAD *computation* happens (that's answered by #2, and it's evidently a Bambu Lab/MakerWorld origin server or job queue, not a CDN edge computation) — it only confirms the delivery layer is a CDN, same category of infrastructure this project already runs on (Cloudflare Pages/Functions/D1/R2).

### 6. OpenSCAD/BOSL2 build provenance

Release notes embedded in the client bundle (`openscad-2bdbe03757813e7f.js`, a version-history array shown in-app) state, in MakerWorld's own words:
- v0.9.1 (Nov 28, 2024): "OpenSCAD version updated to commit `b550957ddac62e59428d08efa62e2f44c15a0b95`" and "BOSL2 library updated to commit `bbf4bc38c055e5cb4cd5311a8ee404501b33ec09`" — confirms they build OpenSCAD from a specific upstream commit (not a tagged release), same general approach as this project's ADR-0006/0011 discussion of building from HEAD to get Manifold support, and confirms BOSL2 is bundled as a standard library.
- v1.1.0 (Oct 27, 2025): "Engine Upgrades: The backend OpenSCAD and BOSL2 libraries have been updated for better performance and stability" — a generic claim with no specifics; logged here because it's the only place "performance" is mentioned in the release notes at all, and it gives no technical detail beyond the fact that they do periodically rebuild their OpenSCAD engine.
- v1.0.0 (Jun 30, 2025): added Fusion 360 (`.f3d`) upload/customization support, a completely different (non-OpenSCAD) code path for parametric models, referencing [forum.bambulab.com/t/179329](https://forum.bambulab.com/t/179329).
- These release notes link to Bambu Lab's own community forum for full changelogs, e.g. [forum.bambulab.com/t/203564](https://forum.bambulab.com/t/203564) (v1.1.0 UI refresh), [forum.bambulab.com/t/144618](https://forum.bambulab.com/t/144618) (v0.10.0 multi-plate 3MF). These weren't individually fetched in this session (out of scope beyond confirming they're real, first-party Bambu Lab channels, matching what the search results below already surfaced independently).

---

## What official/public sources say (search-based, not exhaustive)

No Bambu Lab engineering blog, changelog page, or developer-docs site describing Parametric Model Maker's *backend architecture* (server vs. client compute, caching layer, queueing) was found. What does exist, all first-party Bambu Lab channels found via web search:

- **Bambu Lab's own launch announcement** on X/Twitter: "Embracing OpenSCAD community: Introducing the Parametric Model Maker! ... now live in MakerLab!" ([x.com/BambulabGlobal/status/1778389725843460597](https://x.com/BambulabGlobal/status/1778389725843460597)) — confirms OpenSCAD as the underlying tool, no architecture detail.
- **Bambu Lab community forum threads** (first-party, but user-support-oriented, not engineering docs): e.g. ["Create customizable models on MakerWorld using Parametric Model Maker"](https://forum.bambulab.com/t/create-customizable-models-on-maker-world-using-parametric-model-maker/156334), ["Parametric Model Maker v1.0.0 – Fusion 360 support"](https://forum.bambulab.com/t/parametric-model-maker-v1-0-0-fusion-360-support/179329). These are usage/announcement posts, not infrastructure write-ups.
- **All3DP** (third-party outlet), ["Bambu Lab's 'Parametric Model Maker' Brings OpenSCAD to MakerWorld"](https://all3dp.com/4/bambu-labs-parametric-model-maker-brings-openscad-to-makerworld/) — attempted fetch returned HTTP 403, so this note relies only on the search snippet, which says MakerWorld "runs your OpenSCAD code inside their Parametric Model Maker app and displays the result for the user to download" — vague, and secondhand (this is what a search-engine summary reported about the article, not a verified quote from the article itself, since the article couldn't be loaded).
- **Nelson Chen's blog**, ["Unofficial MakerWorld PMM OpenSCAD Reference"](https://mindflakes.com/posts/2026/05/04/makerworld-pmm-openscad-reference/) — fetched directly; explicitly states it does **not** cover runtime/infrastructure, focusing instead on OpenSCAD-authoring conventions for PMM compatibility. Its own words: "the OpenSCAD side of PMM is documented in a very internet way. Some of it is in release posts. Some of it is in support replies" — i.e. even a dedicated community reference on this exact tool says there's no consolidated official documentation of how it runs, which matches what this session found.

**Explicit gap:** no primary source (Bambu Lab blog, docs, or forum post) was found that states outright "Parametric Model Maker renders server-side" or names the render infrastructure (queue technology, container runtime, instance count, caching layer). The server-side conclusion in this note is inferred from reading MakerWorld's own shipped client code (§2 above), which is strong but not an official statement.

---

## Comparison to this project's own findings

| | This project (`sukjab_scad`) — customer Customize view | MakerWorld Parametric Model Maker (as observed) |
|---|---|---|
| Geometry backend | Manifold, client-side, since ADR-0011 | Manifold, **server-side** (`--backend=manifold`, confirmed in shipped JS) |
| Where compute happens | Browser, via `openscad-wasm` (Emscripten) in a Web Worker | Server (async job submitted over HTTP; no local WASM execution path found for OpenSCAD itself) |
| Trigger | Automatic, on every Configuration change, after a 400ms debounce (`useRenderMesh.ts`) | **Explicit "Generate" click only** — no auto-render on parameter change |
| In-flight-request handling | Superseding change kills and respawns the Worker (`render.worker.ts`) | Superseding request cancels the previous poll via `PollingController.cancelPreviousPollingByType` |
| Default-Configuration speed | Precomputed/cached server-side default Mesh (ADR-0010) served instantly on load | Not observable (login-gated); no evidence either way |
| STL export format | Binary (fixed by commit `15877b0`, this session) | Binary (`--export-format=binstl`, confirmed in shipped JS) — same choice, independently arrived at |
| Source size limit | Not found in this project's code during this research | 1024 KB cap, enforced client-side before submission |
| Render/response timeout | 60s Worker timeout (`RENDER_TIMEOUT_MS`) | ~30s (15 × 2s polls) before a client-side "timeout" error |
| CDN / hosting | Cloudflare Pages/Functions/D1/R2 | Cloudflare (confirmed via response headers: `server: cloudflare`, `cf-cache-status`) |

### Takeaways

1. **MakerWorld's speed is very likely not "faster WASM" — it's "no WASM."** The evidence points to a native, server-side OpenSCAD process (Manifold backend) reached via an async job API, not an in-browser Emscripten/WASM instance at all. This project's own ADR-0006 numbers (native Manifold ≈0.47s vs. CGAL-in-WASM ≈90s for the same model) already explain *why* that would feel fast: it isn't a clever browser trick, it's avoiding the browser-WASM tax entirely for the compute-heavy step. This project already made the same backend choice (Manifold) for its client-side WASM path via ADR-0011, which narrows — but by definition doesn't eliminate — the gap to a native server-side render, since WASM-in-Manifold is still WASM.
2. **The biggest architectural difference this project hasn't weighed is the trigger model, not the engine.** MakerWorld requires an explicit "Generate" click; this project auto-renders on every debounced Configuration change. That's a genuine, previously-undiscussed lever: it eliminates the entire "wasted in-flight render on rapid slider drags" problem the existing research note flags in `useRenderMesh.ts` (§ "Debounce / scheduling") — not by rendering faster, but by rendering less often and more predictably. Whether that trade-off (fewer renders, but no live feedback while dragging) fits this project's UX goals is a product question, not something this note resolves — but it's a real technique MakerWorld uses that isn't in ADR-0010/0011/0012 or the prior research note.
3. **Binary STL export and a Manifold backend are independently corroborated as the right calls** — MakerWorld already does both, for what looks like the same reasons this project's recent commits adopted them.
4. **A "respond inline if fast enough, else poll" pattern** (MakerWorld's `N` function: use the submission response directly if it already has the result, only fall into polling otherwise) is a pattern this project's own async Export Job pipeline (ADR-0005) doesn't currently do for the Admin "Render on server" path, per the earlier research note's description of that pipeline — worth a look if that path is ever revisited, though it's out of scope for the customer-facing preview this note was asked to focus on.
5. **What remains genuinely unknown, stated plainly:** actual observed render latency for a live "Generate" click (blocked by the login wall — this session did not create an account, per this session's operating rules); the real names/technology of the render queue or compute layer behind `a.lx`/`a.Qw`; whether there's any caching of previously-seen (source, params) pairs server-side (this project's ADR-0010 precomputes only the *default* Configuration — no evidence was found, for or against, that MakerWorld does anything analogous for non-default parameter sets); and the exact purpose of the `wasm_exec.js` file prefetched alongside the customizer bundle, which this note could not attribute to OpenSCAD execution and could not otherwise identify.
