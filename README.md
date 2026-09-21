# OpenSCAD Web Management

A web app that lets non-technical users customize parametric OpenSCAD designs through a generated UI, with a live 3D preview and one-click STL export. The Gallery and Customize view are served live by a Cloudflare Worker (Pages Functions) backed by D1, and an authenticated Admin manages the Built-in Template library through an Admin Panel. The `v1` branch is the original fully static, backend-less version of the same app and is frozen — see its own README/CONTEXT.md.

See [CONTEXT.md](./CONTEXT.md) for the project's glossary and [docs/adr](./docs/adr) for architecture decisions.

## Stack

- React + TypeScript + Vite, React Router for the Gallery/Customize/Admin routes
- Three.js / `@react-three/fiber` / `@react-three/drei` for the 3D viewer
- [openscad-wasm](https://github.com/openscad/openscad-wasm) running in a Web Worker for rendering — entirely client-side, unchanged from v1
- Cloudflare Pages + Pages Functions (Workers) + D1 + R2 for the Built-in Template store and Admin API
- Cloudflare Access for Admin authentication (no custom auth code)

## Getting started (local dev)

```bash
npm install
npm run d1:migrate:local   # create the local D1 schema
npm run d1:seed:local      # seed the 3 starter templates from src/templates/builtin/
npm run pages:dev          # builds the frontend, then runs wrangler pages dev
```

Opens on `http://localhost:8789`. Local dev bypasses Cloudflare Access entirely (see `functions/lib/auth.ts`), so `/admin` works immediately with no login.

Deploying for real (D1/R2/Pages/Access setup) is a one-time, account-level process — see [docs/v2-deploy.md](./docs/v2-deploy.md).

## How it works

- **Templates** are `.scad` source annotated with the standard [OpenSCAD Customizer](https://openscad.org/documentation.html#Customizer) comment convention (`// [min:max]` ranges, `// [a,b,c]` dropdowns, `/* [Group] */` sections, `/* [Hidden] */` to exclude a variable). `src/customizer/parseCustomizer.ts` parses those comments into typed `Parameter`s — used identically by the public Customize view and the Admin Panel's live preview.
- **Built-in Templates** live in D1 (`templates` table — see [migrations/0001_init.sql](./migrations/0001_init.sql)), served by [Pages Functions](./functions/api/) at `/api/templates` (public, read-only) and `/api/admin/templates` (Admin-only, gated by [`functions/api/admin/_middleware.ts`](./functions/api/admin/_middleware.ts)). `src/templates/builtin/` still holds the 3 starter templates' source — not bundled into the app anymore, just what [`scripts/seed-d1.mjs`](./scripts/seed-d1.mjs) seeds D1 with.
- **Rendering** is unchanged from v1: `src/worker/render.worker.ts` runs openscad-wasm in a Web Worker, `-D name=value` flags for the current parameter values, a fresh OpenSCAD instance per render (see the ADR-0001 note in CONTEXT.md — openscad-wasm's internal state isn't safe to reuse across `callMain()` calls). `src/state/useRenderMesh.ts` debounces changes and keeps the last valid geometry on screen through a failed render.
- **The Admin Panel** (`/admin`, `src/admin/`) reuses that exact rendering pipeline for its live preview: `AdminEditor.tsx` parses the in-progress `.scad` source, runs it through the same `useRenderMesh`, and only enables Publish once it renders successfully (see [ADR-0002](./docs/adr/0002-admin-validation-runs-client-side.md) — this validation runs in the Admin's own browser, not in the Worker). Publish captures a thumbnail straight from the live preview's canvas and uploads it to R2, then writes the template to D1 — visible in the public Gallery immediately, no redeploy (see [ADR-0003](./docs/adr/0003-v2-gallery-is-fully-dynamic.md)).
- **Export** still downloads the raw STL bytes the worker produced directly — no re-export from the Three.js geometry.

## Adding/editing templates

Once deployed, do this through the Admin Panel at `/admin` — that's the point of v2. For the local starter set specifically (`src/templates/builtin/`, what `seed-d1.mjs` seeds), edit those files directly and re-run `npm run d1:seed:local` / `npm run d1:seed:remote`.

Uploaded `.scad` files (via the Gallery's "Upload your own" card) are unaffected by any of this — still session-only, browser-only, never reach the server (see CONTEXT.md: Uploaded Template).
