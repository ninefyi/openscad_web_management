# OpenSCAD Web Management

A web app that lets non-technical users customize parametric OpenSCAD models through a generated UI and export the result as an STL file. The Gallery and Customize view are served live by a Cloudflare Worker backed by D1, and an authenticated Admin manages the Built-in Template library through an Admin Panel. The `v1` branch is the original fully static, backend-less version of the same app and is frozen — its own `CONTEXT.md` describes it as it was.

Rendering is hybrid: the interactive preview (Customize view and Admin Panel) Renders client-side by default, same as v1, in the end user's or Admin's own browser — but Export and Admin Publish validation always Render server-side, through native OpenSCAD in a Cloudflare Container, via an async Export Job. A Template flagged too expensive to attempt client-side skips the automatic browser Render; the Admin Panel offers Render on server as an alternative to forcing the client-side attempt, but the customer-facing Customize view doesn't — a customer only ever gets an explicit, opt-in client-side Render. See [ADR-0004](./docs/adr/0004-hybrid-client-and-server-rendering.md).

## Language

### Templates & Parameters

**Template**:
A parametric OpenSCAD design (`.scad` source plus its Customizer comments) that the Customize view turns into an editable Mesh. Every Template is a Built-in Template — end users can only browse and customize what the Admin has published, they can no longer supply their own `.scad` file (that end-user upload path existed early in v2 and was removed; see git history if it's ever wanted back).
_Avoid_: Model, Design, File

**Built-in Template**:
A Template curated by the Admin and shown in the Gallery. May have a Template Manifest. Stored in D1 and served live by the Worker; the Admin manages it through the Admin Panel, and a successful Publish is visible to end users immediately, with no redeploy. Can be unlisted without being deleted — see Listed. (In v1, this was instead a file bundled with the app at build time, hand-edited and shipped via a normal code deploy — no Admin role existed.)
_Avoid_: Starter template, Sample

**Listed**:
A Built-in Template's Listed state controls whether it appears in the public Gallery grid and is reachable at its own Customize URL — an Admin can unlist a Template without deleting it, and the Admin Panel always shows and can edit every Template regardless of Listed state. Defaults to Listed.
_Avoid_: Hidden (reserved for Hidden Parameter — a different, per-variable concept), Visible, Published (Published is the Admin's create/save action, not a display toggle)

**Template Manifest**:
The optional display-override data for a Built-in Template — overriding Control labels, adding a Gallery thumbnail/description, reordering fields, or force-hiding a Parameter — without touching the `.scad` file's own Customizer comments. Only Built-in Templates can have one. It can hide additional Parameters, but can never un-hide a Parameter the `.scad` file itself marked Hidden. Stored as a D1 row's fields, edited through the Admin Panel. (In v1, this was a `template.json` sidecar file instead.)
_Avoid_: Metadata, Config

**Parameter**:
A named, user-adjustable value declared in a Template, exposed as a Control in the Customize view. Either Annotated (defined via an OpenSCAD Customizer comment, e.g. a range or dropdown) or Inferred (a bare top-level variable with no Customizer comment, given a best-guess Control). A dropdown Control is Annotated either way, even though its options can come from two different comment forms: OpenSCAD's own same-line `// [a,b,c]` bracket syntax, or a string Parameter's very next line being nothing but a quoted, comma-separated list (`// "a", "b", "c"`) — a pattern real `.scad` authors use for the same purpose without knowing the stricter syntax. `parseCustomizer` recognizes both; a looser prose comment (`// "a" or "b"`) recognizes neither and falls back to a plain text Control.
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
Evaluating a Template + Configuration into a Mesh. Always a full evaluation — OpenSCAD Web Management never uses OpenSCAD's fast/approximate "Preview" mode. See [ADR-0001](./docs/adr/0001-always-render-exact-geometry.md). Happens on one of two engines, which now use different geometry backends: the Customize view and Admin Panel's live preview Renders client-side by default, in a Web Worker through openscad-wasm on the CGAL backend (unchanged since ADR-0001, kept fast and free by design — see [ADR-0004](./docs/adr/0004-hybrid-client-and-server-rendering.md)); an Export Job always Renders server-side, through native OpenSCAD on the Manifold backend — much faster, at the cost of the two engines being able to disagree on precision-sensitive geometry (see [ADR-0006](./docs/adr/0006-manifold-backend-for-server-side-render.md)). A Template estimated likely to hang the client-side engine (see `estimateComplexity`'s `hasExpensiveLoop`) skips the automatic client-side attempt entirely rather than risk it. What happens next depends on who's looking: the Admin Panel offers Render on server as an alternative to forcing the client-side attempt; the customer-facing Customize view doesn't offer that choice at all, only an explicit "Render" button that forces the same client-side attempt anyway. See [ADR-0007](./docs/adr/0007-skip-then-server-fallback-for-expensive-preview.md) and [ADR-0008](./docs/adr/0008-render-on-server-is-admin-only.md).
_Avoid_: Compile, Build, Preview (Preview is a distinct OpenSCAD concept this app deliberately does not use)

**Mesh**:
The triangulated 3D geometry displayed in the Viewer, from whichever Render produced it — the client-side one for a customer, or for an Admin, optionally a Render on server instead. An Export Job's STL otherwise never touches the Viewer's Mesh even though both come from "the same" Template + Configuration — see Export Job for why they're allowed to diverge slightly regardless.
_Avoid_: Model, Geometry

**Export Job**:
A tracked, asynchronous request for a server-side Render. Moves through `queued` → `rendering` → `done`/`failed`; created by a customer's Export, by Admin Publish's server-side validation step, by an admin script's render-only call, or by an Admin's Render on server. Identical requests (same Template version + Configuration) are deduplicated: a new one reuses a prior done Export Job's result instead of rendering again. Despite the name, not every Export Job backs a download — see Render on server for the one that doesn't. See [ADR-0004](./docs/adr/0004-hybrid-client-and-server-rendering.md) and [ADR-0005](./docs/adr/0005-async-export-job-pipeline.md).
_Avoid_: Render job, Task, Queue item

**Render on server**:
The Admin-only action of triggering a server-side Render purely to refresh the Viewer — offered only in the Admin Panel, for a Template flagged too expensive to attempt client-side, as an alternative to forcing the client-side attempt anyway; the customer-facing Customize view never offers this choice (see Render). Backed by the same Export Job pipeline an Export uses (so an identical Configuration hits the same cached result either way), but nothing gets downloaded and no file is offered. The Admin Panel submits raw draft source to `POST /api/admin/render`, same as its Publish validation does. Doesn't auto-refresh on further Configuration changes — each click is a new, deliberate Export Job, same one-off-action spirit as an Export rather than the continuous free compute of the client-side preview (see ADR-0004).
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
The user action of downloading an STL file for the current Configuration — requires a signed-in Account, enforced both in the UI (ExportButton shows "Sign in to export" when signed out) and at `POST /api/export` itself, which 401s an anonymous request. Always goes through a fresh Export Job (a server-side Render via native OpenSCAD) — never a re-export of the Viewer's own client-side Mesh, even though the Viewer is usually already showing the identical result. Not instant: the customer sees the Export Job's progress (queued/rendering) until the file is ready to download.
_Avoid_: Download, Save (Save is a distinct action now — see Saved Design — that persists a Configuration, not a file download; never use the two words for each other)

### Administration (v2 only)

**Admin**:
The single authenticated role, gated by Cloudflare Access, that can create, edit, rename, and delete Built-in Templates through the Admin Panel — or, for scripts, through the same Access application using a Service Token instead of an interactive login. Distinct from a customer's optional Account (see Accounts below) — Admin manages the Built-in Template library; an Account only saves a customer's own Designs and has no administrative capability.
_Avoid_: Operator, Curator, Owner, User

**Admin Panel**:
The authenticated part of the app where the Admin manages the Built-in Template library: writing `.scad` source with a live Customizer-parse preview, editing Template Manifest fields, and Publishing.
_Avoid_: Dashboard, CMS, Backend

**Publish**:
The Admin's action of committing a new or edited Built-in Template so it's visible in the live Gallery. Blocked until two checks both pass: the Template Renders successfully in the Admin's own browser (the client-side pipeline end users get — see [ADR-0002](./docs/adr/0002-admin-validation-runs-client-side.md)), and a server-side Export Job of the exact same draft also succeeds (catching the class of bug that only shows up on the native OpenSCAD path — see [ADR-0005](./docs/adr/0005-async-export-job-pipeline.md)). There is no separate draft or review state: a Template is either successfully Published — live immediately — or not persisted at all.
_Avoid_: Save, Save Draft, Upload (Save now names a distinct customer action — see Saved Design — never use it for an Admin's Publish)

### Accounts (v2 only)

**Account**:
A free, self-service end-user identity (name, email, password) a customer may optionally create to save their work. Entirely separate from Admin — no billing, no email verification, no "forgot password" in this first version. Login is tracked via an Account session, not Cloudflare Access.
_Avoid_: User, Subscription, Member

**Account session**:
The logged-in state for an Account, held in an httpOnly `account_session` cookie backed by a D1 row. Distinct from the anonymous, unauthenticated session token Export's rate limiting uses (see Export) — that token identifies a browser, not a person, and needs no login; the two never intersect.
_Avoid_: Session (ambiguous with the anonymous export session token — always say "Account session" in full)

**Saved Design**:
A Template + Configuration an Account has explicitly saved, so it survives beyond the browser tab that created it — the persisted counterpart to the otherwise ephemeral Configuration (see Configuration). Saving one never produces a downloadable file — that's Export, a completely separate action.
_Avoid_: Project, Draft (this app has no draft concept — see Publish)
