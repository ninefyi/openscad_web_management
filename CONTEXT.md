# OpenSCAD Web Management

A web app that lets non-technical users customize parametric OpenSCAD models through a generated UI and export the result as an STL file. The Gallery and Customize view are served live by a Cloudflare Worker backed by D1, and an authenticated Admin manages the Built-in Template library through an Admin Panel. The `v1` branch is the original fully static, backend-less version of the same app and is frozen — its own `CONTEXT.md` describes it as it was.

Rendering is hybrid: the interactive preview (Customize view and Admin Panel) Renders client-side by default, same as v1, in the end user's or Admin's own browser — but Export and Admin Publish validation always Render server-side, through native OpenSCAD in a Cloudflare Container, via an async Export Job. A Template flagged too expensive to attempt client-side skips the automatic browser Render and offers Render on server instead — an on-demand server Render whose only job is refreshing the Viewer, not producing a download. See [ADR-0004](./docs/adr/0004-hybrid-client-and-server-rendering.md).

## Language

### Templates & Parameters

**Template**:
A parametric OpenSCAD design (`.scad` source plus its Customizer comments) that the Customize view turns into an editable Mesh. Every Template is a Built-in Template — end users can only browse and customize what the Admin has published, they can no longer supply their own `.scad` file (that end-user upload path existed early in v2 and was removed; see git history if it's ever wanted back).
_Avoid_: Model, Design, File

**Built-in Template**:
A Template curated by the Admin and shown in the Gallery. May have a Template Manifest. Stored in D1 and served live by the Worker; the Admin manages it through the Admin Panel, and a successful Publish is visible to end users immediately, with no redeploy. (In v1, this was instead a file bundled with the app at build time, hand-edited and shipped via a normal code deploy — no Admin role existed.)
_Avoid_: Starter template, Sample

**Template Manifest**:
The optional display-override data for a Built-in Template — overriding Control labels, adding a Gallery thumbnail/description, reordering fields, or force-hiding a Parameter — without touching the `.scad` file's own Customizer comments. Only Built-in Templates can have one. It can hide additional Parameters, but can never un-hide a Parameter the `.scad` file itself marked Hidden. Stored as a D1 row's fields, edited through the Admin Panel. (In v1, this was a `template.json` sidecar file instead.)
_Avoid_: Metadata, Config

**Parameter**:
A named, user-adjustable value declared in a Template, exposed as a Control in the Customize view. Either Annotated (defined via an OpenSCAD Customizer comment, e.g. a range or dropdown) or Inferred (a bare top-level variable with no Customizer comment, given a best-guess Control).
_Avoid_: Variable (the raw `.scad` declaration; Parameter is its exposed, user-facing form), Field, Setting

**Hidden Parameter**:
A top-level `.scad` variable deliberately excluded from the Customize view — via the `.scad` file's own `/* [Hidden] */` Customizer group, or, for Built-in Templates only, a Template Manifest override.
_Avoid_: Internal variable, Private parameter

**Control**:
The UI widget bound to a Parameter in the Customize view's parameter panel — slider, dropdown, checkbox, color picker, or text field. Its type comes from the Parameter's Customizer annotation, or is guessed for an Inferred Parameter.
_Avoid_: Widget, Input, Field

**Group**:
A named section (from a Customizer `/* [Section Name] */` comment) used to cluster related Parameters/Controls together in the parameter panel.
_Avoid_: Section, Category

### Session & Rendering

**Configuration**:
The current set of Parameter values a user has dialed in for a Template during the active session. Exists only in the browser; not persisted beyond a localStorage convenience cache.
_Avoid_: Design, Customization, Setup

**Render**:
Evaluating a Template + Configuration into a Mesh. Always a full evaluation — OpenSCAD Web Management never uses OpenSCAD's fast/approximate "Preview" mode. See [ADR-0001](./docs/adr/0001-always-render-exact-geometry.md). Happens on one of two engines, which now use different geometry backends: the Customize view and Admin Panel's live preview Renders client-side by default, in a Web Worker through openscad-wasm on the CGAL backend (unchanged since ADR-0001, kept fast and free by design — see [ADR-0004](./docs/adr/0004-hybrid-client-and-server-rendering.md)); an Export Job always Renders server-side, through native OpenSCAD on the Manifold backend — much faster, at the cost of the two engines being able to disagree on precision-sensitive geometry (see [ADR-0006](./docs/adr/0006-manifold-backend-for-server-side-render.md)). A Template estimated likely to hang the client-side engine (see `estimateComplexity`'s `hasExpensiveLoop`) skips the automatic client-side attempt entirely rather than risk it — the user either forces it anyway or uses Render on server. See [ADR-0007](./docs/adr/0007-skip-then-server-fallback-for-expensive-preview.md).
_Avoid_: Compile, Build, Preview (Preview is a distinct OpenSCAD concept this app deliberately does not use)

**Mesh**:
The triangulated 3D geometry displayed in the Viewer, from whichever Render produced it — normally the client-side one, but for a Template flagged too expensive for that, from a Render on server instead. An Export Job's STL otherwise never touches the Viewer's Mesh even though both come from "the same" Template + Configuration — see Export Job for why they're allowed to diverge slightly regardless.
_Avoid_: Model, Geometry

**Export Job**:
A tracked, asynchronous request for a server-side Render. Moves through `queued` → `rendering` → `done`/`failed`; created by a customer's Export, by Admin Publish's server-side validation step, by an admin script's render-only call, or by a Render on server. Identical requests (same Template version + Configuration) are deduplicated: a new one reuses a prior done Export Job's result instead of rendering again. Despite the name, not every Export Job backs a download — see Render on server for the one that doesn't. See [ADR-0004](./docs/adr/0004-hybrid-client-and-server-rendering.md) and [ADR-0005](./docs/adr/0005-async-export-job-pipeline.md).
_Avoid_: Render job, Task, Queue item

**Render on server**:
The user-facing action of triggering a server-side Render purely to refresh the Viewer — offered only for a Template flagged too expensive to attempt client-side, as an alternative to forcing the client-side attempt anyway. Backed by the same Export Job pipeline an Export uses, but nothing gets downloaded and no file is offered; the customer-facing Customize view submits it exactly like an Export (Template + Configuration) while the Admin Panel submits raw draft source, same as its Publish validation does. Doesn't auto-refresh on further Configuration changes — each click is a new, deliberate Export Job, same one-off-action spirit as an Export rather than the continuous free compute of the client-side preview (see ADR-0004).
_Avoid_: Preview, Server Preview (collides with the OpenSCAD "Preview" mode this app avoids — see Render's own _Avoid_ note)

### Screens & Actions

**Gallery**:
The home screen: a grid of Built-in Template thumbnails.
_Avoid_: Home, Library, Catalog

**Customize view**:
The screen for a selected Template: the Viewer, the grouped parameter panel of Controls, and the Export action.
_Avoid_: Editor, Customizer (Customizer refers to the OpenSCAD annotation convention, not this screen)

**Viewer**:
The Three.js/@react-three/fiber 3D pane in the Customize view that displays the current Mesh.
_Avoid_: Preview, Canvas

**Export**:
The user action of downloading an STL file for the current Configuration. Always goes through a fresh Export Job (a server-side Render via native OpenSCAD) — never a re-export of the Viewer's own client-side Mesh, even though the Viewer is usually already showing the identical result. Not instant: the customer sees the Export Job's progress (queued/rendering) until the file is ready to download.
_Avoid_: Download, Save

### Administration (v2 only)

**Admin**:
The single authenticated role, gated by Cloudflare Access, that can create, edit, rename, and delete Built-in Templates through the Admin Panel — or, for scripts, through the same Access application using a Service Token instead of an interactive login. OpenSCAD Web Management has no end-user accounts at all — Admin is the only authenticated identity in the system.
_Avoid_: Operator, Curator, Owner, User

**Admin Panel**:
The authenticated part of the app where the Admin manages the Built-in Template library: writing `.scad` source with a live Customizer-parse preview, editing Template Manifest fields, and Publishing.
_Avoid_: Dashboard, CMS, Backend

**Publish**:
The Admin's action of committing a new or edited Built-in Template so it's visible in the live Gallery. Blocked until two checks both pass: the Template Renders successfully in the Admin's own browser (the client-side pipeline end users get — see [ADR-0002](./docs/adr/0002-admin-validation-runs-client-side.md)), and a server-side Export Job of the exact same draft also succeeds (catching the class of bug that only shows up on the native OpenSCAD path — see [ADR-0005](./docs/adr/0005-async-export-job-pipeline.md)). There is no separate draft or review state: a Template is either successfully Published — live immediately — or not persisted at all.
_Avoid_: Save, Save Draft, Upload
