# Research: Running OpenSCAD in a Container (a Detailed Review of `openscad/openscad`)

This is a research note, not a decision record. Nothing has been decided based on it. Claims are cited against primary sources: the `openscad/openscad` source tree, its PRs and release notes, the official `openscad/docker-openscad` repo and Docker Hub listing, the OBS nightly repository index, the pinned Manifold submodule, and Cloudflare's own docs and SDK source. Each finding is labeled **Verified** (read in source or docs, or reproduced) or **Inference** (my reasoning from verified facts, not confirmed directly).

Date: 2026-09-29.

Source pins used throughout:

- `openscad/openscad` master at [`325f4808`](https://github.com/openscad/openscad/tree/325f480887dd151311f34065e37bc30b14ed11d6) (2026-09-28). This is **the exact commit the current OBS `openscad-nightly` package was built from** (`Version: 20260928T095005.git325f4808.debian-0` in the [OBS Debian_12 `Packages` index](https://download.opensuse.org/repositories/home:/t-paul/Debian_12/Packages)). In other words, it is what our container gets if it is rebuilt today. Links below of the form `src/…#Ln` are relative to that tree.
- Manifold submodule at [`elalish/manifold@0edd9d5`](https://github.com/elalish/manifold/tree/0edd9d54876f3135e431575214dd6d8a72866fee) (the gitlink recorded in `submodules/manifold` at that commit).
- `openscad/docker-openscad` main at [`fa814e9`](https://github.com/openscad/docker-openscad/tree/fa814e9a5d278e21e207d916ea1e902b616f00b9) (2026-09-23).
- Local reproduction: OpenSCAD snapshot `2026.09.18 (git 033ddb6f)`, Manifold 3.5.2, macOS arm64, 8 CPUs (`openscad --info`). This is not the Linux build we deploy, so treat the timings as illustrative only.

---

## Summary

**Can OpenSCAD run in a container?** Yes, and it is a supported, first-party use case. The OpenSCAD team publishes official images at [`openscad/openscad`](https://hub.docker.com/r/openscad/openscad), built from [`openscad/docker-openscad`](https://github.com/openscad/docker-openscad), and documents `docker run … openscad -o CSG.3mf CSG.scad` as the intended usage in that repo's README. STL/3MF export needs no display and no GL context at all. Only PNG export does. We already run it this way.

The value is in the details, and several of them affect us directly:

1. **Manifold has been the upstream default backend since 2025-08-17** ([PR #5833](https://github.com/openscad/openscad/pull/5833)). Our ADR-0006 and the comment in `server.js` say "CGAL is still the nightly default". That is stale. Keeping `--backend=manifold` is still correct as a defensive setting.
2. **A single render only partly uses multiple cores.** In OpenSCAD's own code, the only explicitly parallel operation is the Manifold-backend `minkowski()`. Parse, evaluation and CSG-tree traversal are serial. Inside Manifold, parallelism only kicks in above 10,000 elements. For a *concave* Minkowski operand, the dominant step (CGAL Nef conversion plus `convex_decomposition_3`) is single-threaded exact arithmetic. So Amdahl's law caps the gain from more vCPUs.
3. **Our build is not reproducible, and apt cannot pin it.** The OBS repo keeps only the latest nightly `.deb`. The official Docker images *do* keep dated, digest-addressable tags, and `files.openscad.org/snapshots` keeps dated, checksummed AppImages back to 2026-01-03.
4. **Security: a signed-in customer can inject arbitrary OpenSCAD code into the server-side render.** `buildDefines` passes three kinds of Configuration value through verbatim as source text: array elements, strings that start with `[`, and object *keys*. OpenSCAD appends `-D` values to the parsed program as raw source. Reproduced locally below. Argv-level option smuggling (for example sneaking in `-m`, which calls `system()`) did **not** work. The impact is bounded to what the OpenSCAD language can do: read geometry-format files anywhere on the filesystem, and burn CPU or RAM until the 4-minute timeout. It cannot write files, exec commands or reach the network. The container also runs as root, with internet egress on by default and no per-render memory cap.
5. **Not an OpenSCAD issue, but found while checking capacity:** `renderViaContainer` calls `getRandom(env.RENDER_CONTAINER, 3)`. That spreads load across **only 3** container instances (`instance-0..2`), so `max_instances = 25` is never reached. `server.js` also has no per-container concurrency cap.

---

## Architecture

### CLI vs GUI; one binary

**Verified.** A single `openscad` executable serves as both GUI and CLI.

- Passing `-o <file>` switches it into "cmd-line mode" and it never creates the GUI ([`src/openscad.cc#L1146-L1152`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/openscad.cc#L1146-L1152)).
- CMake can also build a GUI-less binary: `HEADLESS` and `NULLGL` options ([`CMakeLists.txt#L48`, `#L55`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/CMakeLists.txt#L48)).
- The OBS nightly package is a full GUI build. Its `Depends:` list pulls in Qt6 (`libqt6widgets6`, `libqt6gui6`, `libqt6multimedia6`, `libqscintilla2-qt6-15`, …), `libegl1`, `libglx0`, `libtbb12` and `libpython3.11` ([OBS `Packages`](https://download.opensuse.org/repositories/home:/t-paul/Debian_12/Packages)).
- **Inference:** most of our image weight is GUI libraries we never load in cmd-line mode.

### Evaluation pipeline

**Verified** from `src/openscad.cc`:

1. **Read and append defines.** The source text is read, then every `-D` string is appended after a `\x03` end-of-text marker as `cmd + ";\n"`:
   - defines are collected at [`#L1078-L1083`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/openscad.cc#L1078-L1083);
   - they are appended to the source at [`#L614`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/openscad.cc#L614).
2. **Parse.** Flex/Bison ([`src/core/lexer.l`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/core/lexer.l), [`src/core/parser.y`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/core/parser.y)) produce a `SourceFile` AST ([`#L617`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/openscad.cc#L617)).
3. **Instantiate.** `root_file->instantiate(...)` evaluates the language (variables, functions, modules, loops) into a node tree ([`#L419`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/openscad.cc#L419)).
4. **Build geometry.** `GeometryEvaluator::evaluateGeometry` walks that tree and calls the geometry backend for each CSG operation ([`#L478-L495`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/openscad.cc#L478-L495)).
5. **Export.** `exportFileByName` writes the output ([`#L217`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/openscad.cc#L217)).

A consequence of step 1: `-D` is **source injection by design**. The User Manual says so directly: "the right hand sides can be arbitrary OpenSCAD expressions" ([wikibooks: command line](https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Using_OpenSCAD_in_a_command_line_environment)). In fact it is not limited to right-hand sides. Anything in the string is parsed as top-level statements (reproduced in [Security](#security)).

### Backends: CGAL vs Manifold, and the flag history

**Verified.**

| Date | Change | Source |
|---|---|---|
| ≤2024-07 | Manifold available only as an experimental feature, `--enable=manifold` | [PR #5219](https://github.com/openscad/openscad/pull/5219) (merged "render-colors" into the "manifold" feature) |
| 2024-09-29 | `ExperimentalManifold` feature **removed**; `--backend=manifold` added to production builds | [PR #5235](https://github.com/openscad/openscad/pull/5235), diff to `src/Feature.cc` in [`8d41b4f`](https://github.com/openscad/openscad/commit/8d41b4f7fd) |
| 2024-12-24 | `fast-csg` feature removed | [PR #5529](https://github.com/openscad/openscad/pull/5529) |
| 2025-08-17 | **Manifold made the default backend** ("let's make the switch to Manifold now to get it exposed to more users") | [PR #5833](https://github.com/openscad/openscad/pull/5833); now `DEFAULT_RENDERING_BACKEND_3D = RenderBackend3D::ManifoldBackend` ([`src/glview/RenderSettings.h#L12`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/glview/RenderSettings.h#L12)) |
| 2025-09-15 | An unknown `--backend=` value became a hard error (exit 1) | [PR #6204](https://github.com/openscad/openscad/pull/6204); [`src/openscad.cc#L1025-L1033`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/openscad.cc#L1025-L1033) |

The CLI help now reads `'CGAL' (old/slow) or 'Manifold' (new/fast) [default]` ([`#L888-L889`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/openscad.cc#L888-L889)). The wikibooks CLI page still says CGAL is `[default]`. It is out of date.

Reproduced locally on 2026.09.18 with `difference(){cube(10); sphere(6);}`:

| Flags | Result |
|---|---|
| no flag | `Top level object is a 3D object (manifold)` |
| `--enable=manifold` | prints `WARNING: Ignoring request to enable unknown feature 'manifold'.` ([`src/Feature.cc#L99`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/Feature.cc#L99)), then still renders with Manifold because that is the default |
| `--backend=cgal` | `Nef polyhedron` |
| `--backend=foo` | `ERROR: Unknown rendering backend 'foo'.` and exit 1 |

**Correction to our docs:** ADR-0006 and `server.js` say CGAL is "still openscad-nightly's default" and that `--enable=manifold` "silently no-ops back to CGAL". Both statements were true before 2025-08-17. Neither is true now. The flag is harmless but redundant, and no longer fully silent (it prints a warning). The same applies to MakerWorld's `--enable=fast-csg` noted in `makerworld-parametric-generator-speed.md`: that feature has been gone since PR #5529.

`minkowski()` has one extra wrinkle: even on the Manifold backend it depends on CGAL. See [Performance](#performance). CMake's own warning says CGAL-off builds lose "features that are normally expected … (e.g. Minkowski)" ([`CMakeLists.txt#L598-L605`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/CMakeLists.txt#L598-L605)).

### Export formats

**Verified** ([`src/io/export.cc#L81-L101`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/io/export.cc#L81-L101); CLI help at [`src/openscad.cc#L857-L865`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/openscad.cc#L857-L865)):

- 3D output formats: `asciistl`, `binstl`, `obj`, `off`, `3mf`, `wrl`, `pov`, and others.
- 2D output formats: `dxf`, `svg`, `pdf`.
- Other outputs: `png`, `echo`, `ast`, `csg`, `term`, `param`.

`.stl` still maps to **ASCII** (`identifierToInfo["stl"] = …["asciistl"]`, [`#L101`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/io/export.cc#L101)). The help text says binary "is planned as the future default". Reproduced locally: a plain `-o d1.stl` starts with `solid OpenSCAD_Model`. Our `--export-format=binstl` is still needed. 3MF uses lib3mf, which is in the OBS package's dependencies (`lib3mf-v2-dev`).

### Versions

**Verified.**

- The last stable release is still **2021.01**, published 2021-02-07 ([GitHub releases](https://github.com/openscad/openscad/releases)). There have been no releases since.
- A tag named `openscad-2026.01.01-TEST2` exists (`f2bfab1`), but it has no GitHub release. **Inference:** a release rehearsal, not a release.
- Everything we rely on (Manifold, `--backend`, `binstl` as a named format) exists only in snapshots.
- Unreleased changes are tracked in [`releases/next.md`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/releases/next.md). It lists "New geometry engine: Manifold", `--backend`, "Linux: Can render files to PNG without X11/GLX", and `--summary`/`--summary-file`.

### License

**Verified.**

- `COPYING` is GPL v2 plus a special exception permitting linking with CGAL ([`COPYING`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/COPYING)).
- Source headers say "either version 2 of the License, or (at your option) any later version" ([`src/openscad.cc#L7-L9`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/openscad.cc#L7-L9)).
- Manifold is Apache-2.0 ([LICENSE](https://github.com/elalish/manifold/blob/0edd9d54876f3135e431575214dd6d8a72866fee/LICENSE)).

**Inference (not legal advice):**

- The GPL's obligations attach to *distributing* ("conveying") the program. Running an unmodified binary as a hosted service is not distribution, and GPL v2/v3 (unlike the AGPL) has no network-use clause. Running it for customers therefore triggers no source-offer obligation.
- Pushing the container image to a registry that third parties can pull *would* be distribution. That case would need the usual source/offer compliance, which is simple for an unmodified upstream build.
- `server.js` is a separate program talking to OpenSCAD over argv and files. It is not a derivative work.

---

## Deployment options

### What needs a display or GL, and what doesn't

**Verified.**

- STL, 3MF, OFF and OBJ export go through `evaluateGeometry` and then `exportFileByName`. That path creates no OpenGL context ([`src/openscad.cc#L478-L529`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/openscad.cc#L478-L529)). Only `FileFormat::PNG` touches `OffscreenView`/`export_png`.
- On Linux, the offscreen context providers are EGL (default when compiled in) and GLX ([`src/glview/OffscreenContextFactory.cc#L30-L50`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/glview/OffscreenContextFactory.cc#L30-L50); `ENABLE_EGL` defaults ON, [`CMakeLists.txt#L50`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/CMakeLists.txt#L50)).
- The docker-openscad README still recommends `xvfb-run -a openscad -o CSG.png` plus `--init`, and says "That limitation can go away soon due to the built-in EGL support" ([README](https://github.com/openscad/docker-openscad/blob/fa814e9a5d278e21e207d916ea1e902b616f00b9/README.md)).

For us, this means no Xvfb, Mesa or OSMesa is needed for Export. If a server-rendered PNG thumbnail is ever wanted, EGL with Mesa's software rasterizer is the first thing to try, and `xvfb-run` is the documented fallback.

**Inference:** the Qt libraries are loaded (dynamic linking) but never initialized in `-o` mode. No `DISPLAY` or `QT_QPA_PLATFORM` is needed, which our production already confirms empirically.

### Fonts and `text()`

**Verified.**

- OpenSCAD initializes fontconfig ([`src/FontCache.cc#L150-L200`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/FontCache.cc#L150-L200)) and adds font sources in this order:
  1. its **bundled** fonts directory (`resourcePath("fonts")`, with its own `fonts.conf`);
  2. `$HOME/.fonts`;
  3. every directory in `OPENSCAD_FONT_PATH`;
  4. whatever the system fontconfig configuration lists.
- The bundled set is Liberation **2.00.1** Mono, Sans and Serif ([`fonts/Liberation-2.00.1/`](https://github.com/openscad/openscad/tree/325f480887dd151311f34065e37bc30b14ed11d6/fonts)), installed by [`CMakeLists.txt#L1711`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/CMakeLists.txt#L1711).
- The default font is `Liberation Sans:style=Regular` ([`src/FontCache.cc#L123`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/FontCache.cc#L123)).
- A script can register extra font files with `use <file.ttf|.otf>` ([`src/core/SourceFile.cc#L76-L81`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/core/SourceFile.cc#L76-L81); the [manual's Text page](https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Text) says the same).
- Debian bookworm's `fonts-liberation` is **1.07.4**, not 2.x. That package is 2.1.5 only in trixie and later, and bookworm ships Liberation 2.x as `fonts-liberation2` ([sources.debian.org](https://sources.debian.org/src/fonts-liberation/)).

**Inference:** our container therefore probably has *two* different "Liberation Sans" families visible: OpenSCAD's bundled 2.00.1 and Debian's 1.07.4. Which one fontconfig picks depends on configuration order. Our Dockerfile comment says `fonts-liberation` is there for parity with openscad-wasm, but the bundled copy may already be what gets used, making the apt package redundant or even a source of glyph differences. See [Open questions](#open-questions). `fonts-noto-core` (Noto Sans Thai) is the part that is actually needed.

**Locale — verified.** In CLI mode OpenSCAD calls `setlocale(LC_ALL, "")` ([`src/openscad.cc#L766`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/openscad.cc#L766)). The STL, SVG and DXF exporters force `LC_NUMERIC="C"` while writing, so the decimal separator is always `.` ([`src/io/export_stl.cc#L300-L304`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/io/export_stl.cc#L300)). The default `C`/POSIX locale in `node:22-slim` is fine.

### Distribution channels compared

| Channel | What it is | Pinnable? | Size | Notes |
|---|---|---|---|---|
| **OBS `home:t-paul` apt repo** (what we use) | `openscad-nightly` `.deb`, built from master. Debian 11, 12 and **13** directories now exist ([`home:/t-paul/`](https://download.opensuse.org/repositories/home:/t-paul/)). | **No, verified.** `Packages` and `amd64/` list only the current build (`…20260928T095005.git325f4808…`). Older debs are deleted, so `apt-get install openscad-nightly=<ver>` stops working the next day. | `.deb` is 6.99 MB (amd64), installed 22 MB, **plus** Qt6/Python/TBB/Mesa dependencies (not measured) | Our Dockerfile comment "Nightly repo is Debian-12-only right now" is stale: Debian_13 has the same build. |
| **Official Docker image `openscad/openscad`** | "Official OpenSCAD Docker images", maintained by the OpenSCAD team ([Docker Hub](https://hub.docker.com/r/openscad/openscad)). Built from source by [`openscad/docker-openscad`](https://github.com/openscad/docker-openscad/blob/fa814e9a5d278e21e207d916ea1e902b616f00b9/openscad/bookworm/Dockerfile): multi-stage, `cmake -DEXPERIMENTAL=ON -DSNAPSHOT=ON`, `debian:*-slim` runtime. | **Yes.** Dated tags (`bookworm.2026-09-28`, `trixie.2026-09-28`, `dev.YYYY-MM-DD`) plus immutable digests. For example `bookworm.2026-09-28` amd64 is `sha256:d5ffc939…`. | Compressed: bookworm ~216 MB (amd64), trixie ~240 MB (Docker Hub API) | **Trap:** `latest` = **2021.01**, which has no Manifold and no `--backend` flag, so our `--backend=manifold` would fail. Images run as root (no `USER` line). No Node, so we would have to add it. |
| **AppImage snapshots** | `files.openscad.org/snapshots/OpenSCAD-YYYY.MM.DD-x86_64.AppImage`, each with `.sha256`, `.sha512` and `.asc` signatures | **Yes.** 93 dated AppImages retained, back to 2026-01-03 ([listing](https://files.openscad.org/snapshots/)) | 84.5 MB (2026.09.27) | Self-contained. **Inference:** in a container it must run extracted (`--appimage-extract`, or `APPIMAGE_EXTRACT_AND_RUN=1`) because FUSE is normally unavailable. Not tested here. |
| **Debian `openscad`** | Distro package | Yes | — | 2021.01 (per ADR-0006). No Manifold. |
| **Build from source** | `cmake -DHEADLESS=ON` (or `NULLGL=ON`), `-DENABLE_PYTHON=OFF`, submodules at a pinned commit | **Yes, fully.** | Smallest possible: no Qt | Highest build cost and maintenance. docker-openscad's Dockerfile is a ready template, with `ARG BRANCH`/`REFS` for pinning a commit or tag. |

**Verified:** the openscad.org downloads page lists Docker Hub as a download channel, "currently available for platforms linux/amd64 and linux/arm64" ([downloads](https://openscad.org/downloads.html)).

### Our Dockerfile against these facts

`render-worker/container/Dockerfile`:

- installs whatever nightly is current at build time;
- trusts the OBS key over HTTPS;
- installs the full GUI dependency tree;
- adds `fonts-liberation` (1.07) and `fonts-noto-core`;
- has no `USER` line, so it runs as root;
- runs `node server.js` as PID 1.

**Verified** by reading the file. Every rebuild can silently change the OpenSCAD commit, the Manifold version and the TBB version. A deploy made for an unrelated reason can therefore change geometry output or performance. This matters most because the client-side WASM build is pinned separately (ADR-0011), so the two engines can drift apart without anyone noticing.

---

## Performance

### Where OpenSCAD uses threads

**Verified.**

- **The build forces TBB on whenever Manifold is enabled and the builder did not define `MANIFOLD_PAR`:**
  - `if(NOT DEFINED MANIFOLD_PAR)` → `-DENABLE_TBB`, link `TBB::tbb`, `set(MANIFOLD_PAR ON … FORCE)` ([`CMakeLists.txt#L1190-L1213`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/CMakeLists.txt#L1190-L1213));
  - comment there: "currently only Manifold-related code makes use of TBB parallelization ("exact" CGAL numerics are not thread-safe)";
  - the OBS package depends on `libtbb12`, consistent with this.
- **The Emscripten build forces `MANIFOLD_PAR OFF`** ([`#L294`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/CMakeLists.txt#L294)). **Inference:** the official WASM build we vendor for the client (ADR-0011) is single-threaded Manifold, so the native container gets parallelism the browser never does.
- **OpenSCAD's own code has exactly one explicitly parallel operation: the Manifold-backend `minkowski()`.** A grep for `parallelizable_`, `tbb::`, `std::thread` and `std::async` outside `src/gui` finds only:
  - `src/utils/parallel.h`;
  - `src/geometry/manifold/manifold-applyops-minkowski.cc`;
  - `src/core/HTTPClient.cc` (GUI AI chat, see Security).

  Lexing, parsing, instantiation, and `GeometryEvaluator`'s tree walk are all serial.
- **Manifold parallelizes internally, but only above a size threshold.**
  - `kSeqThreshold = 1e4`; `autoPolicy` returns `Seq` at or below 10,000 elements ([`manifold/src/parallel.h#L39-L49`](https://github.com/elalish/manifold/blob/0edd9d54876f3135e431575214dd6d8a72866fee/src/parallel.h#L39)).
  - Its lazy CSG tree evaluates batched booleans in a `tbb::task_group` ([`manifold/src/csg_tree.cpp#L425-L498`](https://github.com/elalish/manifold/blob/0edd9d54876f3135e431575214dd6d8a72866fee/src/csg_tree.cpp#L425)).
  - OpenSCAD feeds unions, differences and intersections into that lazy tree via `*geom + *chN` etc. ([`src/geometry/manifold/manifold-applyops.cc#L94-L97`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/geometry/manifold/manifold-applyops.cc#L94)).
- **Knobs:** the only runtime switch is the env var `OPENSCAD_NO_PARALLEL`. If it is set, OpenSCAD's own parallel helpers run serially ([`src/utils/parallel.h#L17`, `#L33`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/utils/parallel.h#L17)). There is no CLI flag for thread count. **Inference:** TBB then defaults to the number of hardware threads visible to the process.

### Why a single Minkowski render doesn't scale with vCPUs

**Verified** by reading [`manifold-applyops-minkowski.cc`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/geometry/manifold/manifold-applyops-minkowski.cc). For each pair of operands the algorithm runs these phases:

1. **Per operand, 2 operands in parallel** (`parallelizable_transform` over just the 2 operands, [`#L88`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/geometry/manifold/manifold-applyops-minkowski.cc#L88)):
   - if the operand is convex, its points are taken as-is;
   - if it is concave, it is converted to a **CGAL Nef polyhedron** (exact kernel) and run through **`CGAL::convex_decomposition_3`** ([`#L108-L117`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/geometry/manifold/manifold-applyops-minkowski.cc#L108)). This is serial CGAL code, so at most 2 cores are busy in this phase.
2. **Pairwise hulls, fully parallel.** For every (part_i, part_j), take the point-cloud sum, then `CGAL::convex_hull_3` (inexact `Epick` kernel), via `parallelizable_cross_product_transform` ([`#L213`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/geometry/manifold/manifold-applyops-minkowski.cc#L213)).
3. **Union of all hull parts in Manifold** ([`#L225`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/geometry/manifold/manifold-applyops-minkowski.cc#L225)). This is parallel only above Manifold's 10k threshold.
4. **On any exception,** it falls back to the old Nef Minkowski ([`#L241-L247`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/geometry/manifold/manifold-applyops-minkowski.cc#L241)). That path is fully serial and very slow.

A Manifold-native Minkowski exists behind the compile-time option `USE_MANIFOLD_MINKOWSKI`, which defaults to OFF ([`CMakeLists.txt#L43`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/CMakeLists.txt#L43); [`src/geometry/boolean_utils.cc#L35-L41`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/geometry/boolean_utils.cc#L35)). It is not reachable at runtime in any official build. Upstream still has open issue [#6297, "Performance regression: Concave minkowski slow in Manifold mode"](https://github.com/openscad/openscad/issues/6297).

**Local reproduction (illustrative only; macOS arm64, 8 cores, 2026.09.18).** The test file was `minkowski(){ linear_extrude(4) text("OpenSCAD", size=12); sphere(1, $fn=24); }`, run with `--debug=manifold-applyops-minkowski.cc` to print phase times:

| Measurement | Value |
|---|---|
| Nef conversion | 0.14 s |
| `convex_decomposition_3` | 1.49 s, 270 convex parts |
| Manifold union | 0.005 s |
| Wall time, parallel (default) | 2.66 s (user 5.58 s) |
| Wall time, `OPENSCAD_NO_PARALLEL=1` | 4.04 s (user 5.15 s) |

So 8 cores bought about 1.5×. The ~1.6 s of serial CGAL decomposition is the floor.

**Inference about ADR-0014.** The ADR's numbers are:

- `lite` (1/16 vCPU): 80–120 s;
- `standard-2` (1 vCPU): ~120–127 s;
- `standard-4` (4 vCPU): ~18 s.

The source-level picture above doesn't fully explain them:

- A 16× larger CPU share (lite → standard-2) with *no* change is surprising for CPU-bound work. That suggests the bottleneck on those tiers was not CPU share. Candidates are memory (256 MiB on lite vs 6 GiB on standard-2), cold start or image pull, or burstable CPU.
- A ~7× gain from 1 → 4 vCPU is super-linear, which TBB alone cannot deliver. More RAM on standard-4 (12 GiB) is one candidate cause.

The ADR's conclusion ("standard-4 is faster for our worst Template") is empirically sound. Its stated *mechanism* ("TBB needs ≥2 cores") is only part of the story. Both the ADR and our own measurement agree that a Template whose cost is dominated by concave decomposition will not keep scaling with more vCPUs.

### Memory, caching and other knobs

- **Caches — verified.** OpenSCAD's caches are in-process only:
  - `GeometryCache` defaults to 100 MiB ([`src/geometry/GeometryCache.h#L13`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/geometry/GeometryCache.h#L13));
  - there is also a separate `CGALCache`;
  - both sizes are settable only from GUI Preferences ([`src/gui/Preferences.cc#L724-L731`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/gui/Preferences.cc#L724)). There is no CLI cache flag.
  - Because we spawn one process per render, nothing is reused across renders. Our Export Job dedupe (`config_hash`) is the only cross-render cache, and that is the right layer for it.
  - `--summary cache|time|geometry` and `--summary-file` expose statistics as JSON ([`src/openscad.cc#L904-L908`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/openscad.cc#L904)).
- **Allocator — verified.** mimalloc is on by default (`USE_MIMALLOC ON`, [`CMakeLists.txt#L60`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/CMakeLists.txt#L60)). **Inference:** this makes `RLIMIT_AS`-style virtual-memory caps risky, because mimalloc and TBB reserve address space. Cap resident memory instead.
- **Memory needs — not measured.** Upstream documents no numbers. **Inference:** peak memory is dominated by Nef polyhedra (exact rationals) during concave Minkowski and by very high `$fn`, and can reach multiple GB. Measure with `/usr/bin/time -v` inside the container.
- **`lazy-union` — verified.** This experimental feature exists ([`src/Feature.cc#L32`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/Feature.cc#L32)). The official Docker images are built `EXPERIMENTAL=ON`. The OBS build's experimental setting is not verified here. It changes semantics (top-level objects are not unioned), so it is not a free win.

---

## Security

### What a `.scad` script (or an injected `-D`) can do

**Verified** from source:

| Capability | Available? | Detail |
|---|---|---|
| Read files | **Yes, anywhere the process can read.** Absolute paths are accepted as-is ([`src/core/parsersettings.cc#L89`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/core/parsersettings.cc#L89)). | `include`/`use` read `.scad` files. `import()` reads STL, OFF, OBJ, 3MF, SVG, DXF and nef3 ([`src/core/ImportNode.cc#L200-L231`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/core/ImportNode.cc#L200)). `surface()` reads `.dat`/`.png`. `use <x.ttf>` registers fonts. The data-returning `import()` *function* (JSON) is gated behind the experimental `import-function` feature ([`src/core/builtin_functions.cc#L1368`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/core/builtin_functions.cc#L1368)), which we don't enable. **Inference:** exfiltration is limited to content that parses as geometry and ends up in the returned mesh. Arbitrary text files can't be read into strings, and parser errors print only a line number ([`src/core/parser.y#L719-L724`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/core/parser.y#L719)). |
| Write files | **No** from the language. | The only writers are CLI flags: `-o`, `-d` deps file, `--summary-file`. |
| Exec commands | **No** from the language. | `system()` exists only in `handle_dep`, and only when the **`-m make_cmd` CLI flag** is passed ([`src/handle_dep.cc#L38-L43`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/handle_dep.cc#L38)). We never pass `-m`. |
| Python | **Off for us.** | Built only with `ENABLE_PYTHON`. The OBS package links `libpython3.11`, so **inference:** the nightly is built with it. Even so, Python runs only when the *input file ends in `.py`* **and** `--trust-python` is passed ([`src/openscad.cc#L598-L611`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/openscad.cc#L598), [`#L979-L982`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/openscad.cc#L979)). `server.js` always writes `input.scad` and never passes that flag. The feature's own description warns of "risk of malicious scripts" ([`src/Feature.cc#L57-L58`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/Feature.cc#L57)). |
| Network | **No** from the language. | `HTTPClient`/`AIService` exist in `src/core` but are used only by the GUI AI chat widget (`src/gui/ai/ChatWidget.cc`). |
| Output | Unbounded | `echo()` goes to stdout/stderr. `server.js` buffers all of it in memory, with no cap. |
| CPU/RAM | **Unbounded, apart from narrow per-construct guards** | Ranges are capped at 1,000,000 elements in list comprehensions ([`src/core/Expression.cc#L821`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/core/Expression.cc#L821)). Tail recursion is capped at 1,000,000 ([`#L626`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/core/Expression.cc#L626)). Stack depth is guarded against `RLIMIT_STACK` ([`src/utils/StackCheck.h`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/utils/StackCheck.h)). But nested loops multiply freely, and `$fn` has **no upper cap** (`ceil(fn)` used directly, [`src/core/CurveDiscretizer.cc#L109-L113`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/core/CurveDiscretizer.cc#L109)). There is no global execution budget, so the wall-clock timeout is the only real bound. |

Upstream has a private reporting channel (security@openscad.org) but publishes no threat model for running untrusted scripts ([`SECURITY.md`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/SECURITY.md)). Treat OpenSCAD as a C++ file parser (STL, 3MF, SVG, DXF, fonts) that has not been hardened for hostile input.

### Our trust boundary, and the `-D` injection

Who controls what reaches the container:

- The **Admin** controls Template source, and the Admin render route accepts raw source ([`functions/api/admin/render.ts`](../../functions/api/admin/render.ts)). The Admin is behind Cloudflare Access, so this is trusted.
- **Any signed-in Account**, and Accounts are free self-service, controls `configuration`. That field is arbitrary JSON, stored as-is ([`functions/api/export/index.ts`](../../functions/api/export/index.ts)) and never checked against the Template's Parameters.

`buildDefines` in [`render-worker/src/index.ts`](../../render-worker/src/index.ts) builds `${name}=${serializeConfigValue(value)}` from that JSON. `server.js` passes the results as `["-D", d]` pairs.

**Is it shell-safe? Verified: yes.** `spawn("openscad", args, { timeout })` passes no `shell` option. Node's default is `shell: false`, which means the binary is executed directly with an argv array, and no shell ever interprets the strings ([Node `child_process.spawn`](https://nodejs.org/api/child_process.html#child_processspawncommand-args-options)).

**Can a define smuggle in a CLI option? Verified locally: no, on this build.** Values such as `-mtouch X #=1`, `-m=…`, `--m=…`, `-o=…` and `--o=…` placed after `-D` were all consumed as the `-D` value. The result was an OpenSCAD parse error, not an option, and no marker file was created. **Caveat:** this used the local Boost 1.92. The OBS Debian build uses Boost 1.74 and was not tested.

**Is it OpenSCAD-source-safe? Verified: no.** I replayed `serializeConfigValue` in Node against local OpenSCAD with a Template containing `label="x"; echo(label=label); cube(1);`:

| Configuration sent | Result |
|---|---|
| `{label: 'a"; echo("INJECTED-STR"); b="'}` (plain string) | **Safe.** JSON escaping holds; it echoes the literal string. |
| `{label: '[1]; echo("INJECTED-VEC"); z=[1]'}` (string starting with `[`, passed through raw) | **Injected:** `ECHO: "INJECTED-VEC"` |
| `{label: ['1]; echo("INJECTED-ARR"); z=[1']}` (array; elements `join(",")`-ed raw) | **Injected:** `ECHO: "INJECTED-ARR"` |
| `{'label=1; echo("INJECTED-KEY"); q': 1}` (object key used raw) | **Injected:** `ECHO: "INJECTED-KEY"` |
| `{'$fn': 1000000}` (key not in the Template at all) | Accepted. Sets `$fn` globally, a one-line DoS with no injection syntax needed. |

A separate local test confirmed that injected statements produce geometry: an extra `translate([100,0,0]) cube(5)` showed up in the exported STL.

**Impact (inference).** A free, signed-in customer can make the server run arbitrary OpenSCAD for up to 4 minutes per job, limited to the capabilities in the table above:

- read geometry-format files from the container's filesystem into their STL;
- attempt parser-level memory-safety bugs in lib3mf, SVG, DXF or FreeType parsing, as root;
- exhaust CPU and RAM.

The rate limit is keyed by a client-supplied `sessionToken`, which is freely rotatable. Its own comment says it is "not adversarial-proof". The cost exposure is bounded only by `max_instances` and the queue.

### Container-level posture

**Verified by reading our files:**

- **Runs as root.** There is no `USER` in the Dockerfile. `node:22-slim` ships a non-root `node` user for this purpose ([docker-node best practices](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md#non-root-user)).
- **Internet egress is on.** `RenderContainer` does not set `enableInternet`, and `@cloudflare/containers` defaults it to `true` (`README.md` in the package; `container.js` sets `enableInternet = true`). OpenSCAD never needs the network.
- **Per render, only a wall-clock limit.** There is a 4-minute limit via `spawn`'s `timeout`, which sends SIGTERM by default. There is no memory or CPU cap per process and no concurrency cap per container.
- **Output is buffered without bounds.** Neither `output +=` for stdout/stderr nor `readFile(outputPath)` for the result is bounded. The Worker then does `response.arrayBuffer()`, and Workers have a 128 MB per-isolate memory limit ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)). **Inference:** a very large STL (for example from a huge `$fn`) will fail in the Worker even if the container succeeds.
- **Error strings expose paths.** On failure, stderr (including `/tmp/scad-XXXX/input.scad` paths) is returned to the job's `error` field. This is minor information disclosure.

---

## Recommendations for this repo

Ordered by risk × effort. None of these are implemented. This note changes no code.

1. **Validate `configuration` against the Template's Parameters before building `-D` strings** (Export route and/or `buildDefines`). Evidence: the injection table above.
   - Allow only keys that are non-Hidden Parameters parsed from the Template source, matching `^[A-Za-z_][A-Za-z0-9_]*$`. Reject `$`-prefixed keys.
   - Serialize by the Parameter's type: numbers must be finite (then apply range clamps from the Customizer annotation); strings via `JSON.stringify`; vectors element-by-element as finite numbers. Remove the raw `[`-passthrough, or re-parse it as a numeric vector.
   - This removes the only untrusted-code path into the container. It matters more than any container hardening.
2. **Fix the container fan-out.** Evidence: `getRandom(binding, instances = 3)` picks from `instance-0..2` only (`node_modules/@cloudflare/containers/dist/lib/utils.js`). Queue consumers autoscale up to 250 concurrent invocations by default ([Queues consumer concurrency](https://developers.cloudflare.com/queues/configuration/consumer-concurrency/)).
   - Pass `25`, or better, derive it from the same constant as `max_instances`.
   - Set `max_concurrency` on the consumer to match.
   - Make `server.js` refuse or queue a second concurrent render (return 503 so the queue retries). One OpenSCAD per 4 vCPU/12 GiB container is what ADR-0014 measured. Today several renders can share a container and OOM each other.
3. **Pin OpenSCAD.** Evidence: OBS keeps only the latest `.deb`. Options, in order of effort:
   - (a) **Base on `openscad/openscad:bookworm.YYYY-MM-DD@sha256:…`** (or trixie) and add Node. This is official, pinned by digest, and built from source. Never use `latest`, which is 2021.01.
   - (b) Download a dated **AppImage** by URL, verify its `.sha256`, and run it extracted.
   - (c) Mirror the specific OBS `.deb` into our own storage with its SHA256 from `Packages`.

   In every case, record the OpenSCAD commit (`openscad --info` prints `git <sha>`). Bump it deliberately, together with the client WASM build (ADR-0011's parity discipline).
4. **Run as non-root with a read-only root filesystem where the platform allows it.** Evidence: no `USER` today. Add `USER node`, and make sure `tmpdir()` is writable. **Inference:** fontconfig's system cache is built at apt install time, so a non-root user only needs a writable `$HOME/.cache` or `XDG_CACHE_HOME`.
5. **Disable egress:** `enableInternet = false` on `RenderContainer`. Evidence: default `true`, and OpenSCAD has no network use in CLI mode.
6. **Per-render resource limits in `server.js`:**
   - cap captured stdout/stderr (for example at 64 KB);
   - check the output file size before reading it;
   - kill with SIGKILL after a grace period following SIGTERM;
   - cap resident memory (a cgroup if the platform exposes one; otherwise a watchdog on `/proc/<pid>/status` VmRSS). Avoid `ulimit -v`, because mimalloc and TBB reserve large amounts of virtual address space.
   - Add `--init`-style signal handling (for example `tini`), or have Node reap children, so a killed OpenSCAD does not linger as a zombie.
7. **Stream the result instead of buffering it.** Pipe `response.body` into `R2.put` in `renderViaContainer` rather than calling `arrayBuffer()`. Evidence: the 128 MB Worker memory limit.
8. **Update stale docs.**
   - ADR-0006 and `server.js`: Manifold has been the default since PR #5833, and `--enable=manifold` now warns and has been meaningless since PR #5235. Keep `--backend=manifold` as an explicit pin; with PR #6204 a typo there now fails loudly.
   - Dockerfile: Debian_13 exists on OBS.
   - ADR-0014's mechanism paragraph should get the more precise picture from [Performance](#performance).
9. **Measure before buying more vCPU.** On the worst Template, inside the real container:
   - `openscad --info` (CPUs seen);
   - `--summary time --summary-file -`;
   - `--debug=manifold-applyops-minkowski.cc` (per-phase times);
   - an A/B with `OPENSCAD_NO_PARALLEL=1`;
   - `/usr/bin/time -v` (peak RSS).

   If concave decomposition dominates, more cores won't help. What helps is restructuring the Template: Minkowski on convex pieces, `hull()` where possible, or `offset()` in 2D before `linear_extrude`.
10. **Slim the image (optional, lower priority).** A source build with `-DHEADLESS=ON -DENABLE_PYTHON=OFF`, following docker-openscad's multi-stage Dockerfile, drops Qt, Python and GL. This means faster cold starts (`sleepAfter = "2m"` makes cold starts common) and a smaller attack surface, at the cost of owning a C++ build.
11. **Check the Liberation font duplication.** See Open questions. If the bundled 2.00.1 fonts win, remove `fonts-liberation` (1.07). If they don't, switch to `fonts-liberation2` so the version matches upstream's bundle.

---

## Open questions

- **How many CPUs does TBB see inside a Cloudflare `standard-4`?** It could be the host core count rather than 4. Cloudflare's limits page does not say whether vCPUs are dedicated or shared ([Containers limits](https://developers.cloudflare.com/containers/platform-details/limits/)). Oversubscription would hurt when several renders share a container. Check with `openscad --info` and `nproc` in the container.
- **What actually produced ADR-0014's lite ≈ standard-2 result, and the super-linear 7× on standard-4?** Memory, cold start, and CPU burst are all candidates. This needs the measurements in Recommendation 9.
- **Which "Liberation Sans" does fontconfig pick in our container**, OpenSCAD's bundled 2.00.1 or Debian's 1.07.4? And which version does openscad-wasm's font bundle use? Check with `fc-match "Liberation Sans"` plus a `text()` STL diff between server and browser.
- **Is OBS `openscad-nightly` built with `EXPERIMENTAL=ON` and `ENABLE_PYTHON=ON`?** The `libpython3.11` dependency suggests Python is on. `openscad --help` inside the container would show `--enable` and `--trust-python`.
- **Does Boost 1.74's `program_options` (Debian 12) consume dash-prefixed `-D` values the same way the tested Boost 1.92 did?** Recommendation 1 makes this moot.
- **Will a 2026 stable release land?** A `2026.01.01-TEST2` tag exists but there is no release. A stable tag would be the cleanest pin target.

---

## Sources

**OpenSCAD source (`openscad/openscad@325f4808`):**

- [`src/openscad.cc`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/openscad.cc): CLI options, `-D` handling, pipeline, locale, Python gating
- [`src/glview/RenderSettings.h`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/glview/RenderSettings.h), [`src/Feature.cc`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/Feature.cc)
- [`CMakeLists.txt`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/CMakeLists.txt): `MANIFOLD_PAR`/TBB, `HEADLESS`, `NULLGL`, `ENABLE_EGL`, `ENABLE_PYTHON`, `USE_MANIFOLD_MINKOWSKI`, mimalloc, font install
- [`src/geometry/manifold/manifold-applyops-minkowski.cc`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/geometry/manifold/manifold-applyops-minkowski.cc), [`src/utils/parallel.h`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/utils/parallel.h), [`src/geometry/boolean_utils.cc`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/geometry/boolean_utils.cc), [`src/geometry/manifold/manifold-applyops.cc`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/geometry/manifold/manifold-applyops.cc)
- [`src/io/export.cc`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/io/export.cc), [`src/io/export_stl.cc`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/io/export_stl.cc), [`src/glview/OffscreenContextFactory.cc`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/glview/OffscreenContextFactory.cc)
- [`src/FontCache.cc`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/FontCache.cc), [`src/core/SourceFile.cc`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/core/SourceFile.cc), [`src/core/parsersettings.cc`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/core/parsersettings.cc), [`src/core/ImportNode.cc`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/core/ImportNode.cc), [`src/core/builtin_functions.cc`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/core/builtin_functions.cc), [`src/handle_dep.cc`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/handle_dep.cc), [`src/core/lexer.l`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/core/lexer.l), [`src/core/parser.y`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/core/parser.y), [`src/core/Expression.cc`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/core/Expression.cc), [`src/core/CurveDiscretizer.cc`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/core/CurveDiscretizer.cc), [`src/utils/StackCheck.h`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/utils/StackCheck.h), [`src/geometry/GeometryCache.h`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/src/geometry/GeometryCache.h)
- [`COPYING`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/COPYING), [`SECURITY.md`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/SECURITY.md), [`releases/next.md`](https://github.com/openscad/openscad/blob/325f480887dd151311f34065e37bc30b14ed11d6/releases/next.md), [`fonts/`](https://github.com/openscad/openscad/tree/325f480887dd151311f34065e37bc30b14ed11d6/fonts)

**OpenSCAD PRs, issues and releases:**

- PRs: [#5219](https://github.com/openscad/openscad/pull/5219), [#5235](https://github.com/openscad/openscad/pull/5235), [#5529](https://github.com/openscad/openscad/pull/5529), [#5833](https://github.com/openscad/openscad/pull/5833), [#6204](https://github.com/openscad/openscad/pull/6204)
- Issue: [#6297](https://github.com/openscad/openscad/issues/6297)
- [Releases](https://github.com/openscad/openscad/releases)

**Manifold (`elalish/manifold@0edd9d5`):**

- [`src/parallel.h`](https://github.com/elalish/manifold/blob/0edd9d54876f3135e431575214dd6d8a72866fee/src/parallel.h), [`src/csg_tree.cpp`](https://github.com/elalish/manifold/blob/0edd9d54876f3135e431575214dd6d8a72866fee/src/csg_tree.cpp), [`CMakeLists.txt`](https://github.com/elalish/manifold/blob/0edd9d54876f3135e431575214dd6d8a72866fee/CMakeLists.txt) (`MANIFOLD_PAR` defaults OFF upstream; OpenSCAD forces it ON), [`LICENSE`](https://github.com/elalish/manifold/blob/0edd9d54876f3135e431575214dd6d8a72866fee/LICENSE)

**Distribution:**

- Docker Hub [`openscad/openscad`](https://hub.docker.com/r/openscad/openscad): description, tags and digests via `hub.docker.com/v2/repositories/openscad/openscad/tags`
- [`openscad/docker-openscad@fa814e9`](https://github.com/openscad/docker-openscad/tree/fa814e9a5d278e21e207d916ea1e902b616f00b9): `README.md`, `openscad/bookworm/Dockerfile`, `openscad/trixie/Dockerfile`, `openscad/bookworm/hooks/build`
- OBS: [`home:/t-paul/`](https://download.opensuse.org/repositories/home:/t-paul/), [`Debian_12/Packages`](https://download.opensuse.org/repositories/home:/t-paul/Debian_12/Packages), [`Debian_12/amd64/`](https://download.opensuse.org/repositories/home:/t-paul/Debian_12/amd64/)
- [files.openscad.org/snapshots](https://files.openscad.org/snapshots/); [openscad.org/downloads](https://openscad.org/downloads.html)
- Debian: [fonts-liberation](https://sources.debian.org/src/fonts-liberation/), [fonts-liberation2](https://sources.debian.org/src/fonts-liberation2/)

**Documentation:**

- OpenSCAD User Manual: [command line](https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Using_OpenSCAD_in_a_command_line_environment) (note: still lists CGAL as default), [Text](https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Text)
- Cloudflare: [Containers limits](https://developers.cloudflare.com/containers/platform-details/limits/), [Queues consumer concurrency](https://developers.cloudflare.com/queues/configuration/consumer-concurrency/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [`@cloudflare/containers` 0.3.7](https://www.npmjs.com/package/@cloudflare/containers) as installed in `render-worker/node_modules`: `dist/lib/utils.js` (`getRandom`), `README.md` (`enableInternet` defaults to `true`)
- [Node.js `child_process.spawn`](https://nodejs.org/api/child_process.html#child_processspawncommand-args-options); [docker-node non-root user](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md#non-root-user)

**This repo:**

- `render-worker/container/Dockerfile`, `render-worker/container/server.js`, `render-worker/src/index.ts`, `render-worker/wrangler.toml`, `functions/api/export/index.ts`, `functions/api/admin/render.ts`, `functions/lib/jobs.ts`, `functions/lib/rateLimit.ts`
- `docs/adr/0004`, `0005`, `0006`, `0011`, `0014`; `CONTEXT.md`
