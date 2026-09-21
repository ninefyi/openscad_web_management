# sukjab_scad

A static, client-side web app that lets non-technical users customize parametric OpenSCAD designs through a generated UI, with a live 3D preview and one-click STL export. No backend, no accounts — everything runs in the browser.

See [CONTEXT.md](./CONTEXT.md) for the project's glossary and [docs/adr](./docs/adr) for architecture decisions.

## Stack

- React + TypeScript + Vite
- Three.js / `@react-three/fiber` / `@react-three/drei` for the 3D viewer
- [openscad-wasm](https://github.com/openscad/openscad-wasm) running in a Web Worker for rendering

## Getting started

```bash
npm install
npm run dev
```

## How it works

- **Templates** are `.scad` files annotated with the standard [OpenSCAD Customizer](https://openscad.org/documentation.html#Customizer) comment convention (`// [min:max]` ranges, `// [a,b,c]` dropdowns, `/* [Group] */` sections, `/* [Hidden] */` to exclude a variable). Built-in templates live in `src/templates/builtin/<id>/`, each with the `.scad` source plus an optional `template.json` manifest for display overrides.
- `src/customizer/parseCustomizer.ts` parses those comments into typed `Parameter`s.
- `src/worker/render.worker.ts` runs openscad-wasm in a Web Worker: it writes the `.scad` source into the wasm virtual filesystem, passes the current parameter values as `-D name=value` CLI flags, and reads back the compiled `.stl`. **A fresh OpenSCAD instance is created per render** — openscad-wasm is built as a one-shot CLI and its internal state isn't safe to reuse across multiple `callMain()` calls.
- `src/state/useRenderMesh.ts` debounces parameter changes, talks to the worker, and keeps the last successfully rendered geometry on screen if a render fails (see [ADR-0001](./docs/adr/0001-always-render-exact-geometry.md)).
- Export downloads the raw STL bytes the worker produced directly — no re-export from the Three.js geometry, so what you download is exactly what OpenSCAD generated.

## The `public/openscad/` files

These are the official pre-built openscad-wasm release artifacts (from the [2022.03.20 GitHub release](https://github.com/openscad/openscad-wasm/releases/tag/2022.03.20)), vendored directly rather than pulled from npm — the project isn't published there. `openscad.fonts.js` (~8MB) is included so `text()` works for things like the keychain template; `openscad.mcad.js` (the MCAD extended primitives library) was left out since none of the starter templates need it — add it the same way if a future template does.

## Adding a template

1. Drop a `.scad` file annotated with Customizer comments into `src/templates/builtin/<id>/<id>.scad`.
2. Add a `template.json` next to it (see the existing templates for the shape: `name`, `description`, optional `labels`/`order`/`hide`).
3. Register both in `src/templates/registry.ts`.

This is the only way to add a template — end users can only browse and customize what's bundled here; there's no end-user upload path (removed — see CONTEXT.md: Template).
