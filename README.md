# OpenSCAD Web Management

A web app that lets non-technical users customize parametric OpenSCAD designs through a generated UI, with a live 3D preview and one-click STL export. The Gallery and Customize view are served live by a Cloudflare Worker (Pages Functions) backed by D1, and an authenticated Admin manages the Built-in Template library through an Admin Panel. Rendering is hybrid — the customer-facing preview stays entirely client-side, but a customer's Export always Renders server-side, through native OpenSCAD in a Cloudflare Container (see [ADR-0004](./docs/adr/0004-hybrid-client-and-server-rendering.md)); the Admin Panel can trigger either engine on demand. The `v1` branch is the original fully static, backend-less version of the same app and is frozen — see its own README/CONTEXT.md.

See [CONTEXT.md](./CONTEXT.md) for the project's glossary and [docs/adr](./docs/adr) for architecture decisions.

## Stack

- React + TypeScript + Vite, React Router for the Gallery/Customize/Admin routes
- Three.js / `@react-three/fiber` / `@react-three/drei` for the 3D viewer
- [openscad-wasm](https://github.com/openscad/openscad-wasm) running in a Web Worker for the interactive preview — entirely client-side, unchanged from v1
- Cloudflare Pages + Pages Functions (Workers) + D1 + R2 for the Built-in Template store, Admin API, and Export Job tracking
- `render-worker/` — a separate standalone Worker (Pages Functions can't run Containers or consume Queues) running native OpenSCAD in a Cloudflare Container, consuming a Cloudflare Queue for every Export/Publish-validation/admin-script Render (see [ADR-0005](./docs/adr/0005-async-export-job-pipeline.md))
- Cloudflare Access for Admin authentication (no custom auth code) — also covers admin scripts via a Service Token

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
- **The interactive preview** is unchanged from v1: `src/worker/render.worker.ts` runs openscad-wasm in a Web Worker, `-D name=value` flags for the current parameter values, a fresh OpenSCAD instance per render (see the ADR-0001 note in CONTEXT.md — openscad-wasm's internal state isn't safe to reuse across `callMain()` calls). `src/state/useRenderMesh.ts` debounces changes and keeps the last valid geometry on screen through a failed render. The Admin Panel's live preview (`src/admin/AdminEditor.tsx`) reuses this exact pipeline while authoring, same as before.
- **A customer's Export, and an Admin's Render on server / Export**, go server-side: `src/api/exportClient.ts` submits an Export Job (`POST /api/export` for a customer, `POST /api/admin/render` — with an optional `format: "stl" | "3mf"` — for the Admin) and polls `GET /api/jobs/:id` until it's `done`/`failed`. `functions/lib/jobs.ts` handles job creation, caching (identical request + format reuse a prior result), and a queue-position estimate for progress messaging; `functions/lib/rateLimit.ts` guards customer exports with a simple per-browser-session limit (the Admin route has neither cache nor rate limit — see its own comment). The actual render happens in `render-worker/` — see its own comments and [ADR-0005](./docs/adr/0005-async-export-job-pipeline.md) for why that's a separate Worker project.
- **Save** (`src/admin/AdminEditor.tsx`) is pure metadata persistence — no Render check first (see [ADR-0009](./docs/adr/0009-admin-save-and-export-rework.md)). It captures a thumbnail straight from the client-side preview's canvas and uploads it to R2, then writes the template to D1 — visible in the public Gallery immediately, no redeploy (see [ADR-0003](./docs/adr/0003-v2-gallery-is-fully-dynamic.md)). Two always-available buttons, "Render (browser)" and "Render (server)", let the Admin check either engine on demand, independent of Saving. The Admin's own Export (STL or 3MF) reuses the browser's already-rendered Mesh instantly via `three`'s `STLExporter` when there is one, falling back to a fresh server-side Export Job otherwise — 3MF always goes server-side, since the vendored `openscad-wasm` build has no lib3mf compiled in.

## Adding/editing templates

Once deployed, do this through the Admin Panel at `/admin` — that's the point of v2. End users can only browse and customize what's published there; there's no end-user upload path (removed — see CONTEXT.md: Template). For the local starter set specifically (`src/templates/builtin/`, what `seed-d1.mjs` seeds), edit those files directly and re-run `npm run d1:seed:local` / `npm run d1:seed:remote`.
