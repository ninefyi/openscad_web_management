# OpenSCAD Web Management

A web app that lets non-technical users customize parametric OpenSCAD models through a generated UI and export the result as an STL file. The Gallery and Customize view are served live by a Cloudflare Worker backed by D1, and an authenticated Admin manages the Built-in Template library through an Admin Panel. The `v1` branch is the original fully static, backend-less version of the same app and is frozen — its own `CONTEXT.md` describes it as it was.

Rendering is hybrid: the customer-facing Customize view Renders client-side only, same as v1, in the end user's own browser — automatically, unless a Template is too expensive to attempt automatically, in which case an explicit "Render" button forces it. A customer's Export always Renders server-side instead, through native OpenSCAD in a Cloudflare Container, via an async Export Job — never the client-side engine. The Admin Panel can trigger either engine at any time via two always-available buttons (Render on server), and Saving a Template no longer requires either to have succeeded first (see [ADR-0009](./docs/adr/0009-admin-save-and-export-rework.md)). See [ADR-0004](./docs/adr/0004-hybrid-client-and-server-rendering.md).

## Language

### Templates & Parameters

**Template**:
A parametric OpenSCAD design (`.scad` source plus its Customizer comments) that the Customize view turns into an editable Mesh. Every Template is a Built-in Template — end users can only browse and customize what the Admin has published, they can no longer supply their own `.scad` file (that end-user upload path existed early in v2 and was removed; see git history if it's ever wanted back).
_Avoid_: Model, Design, File

**Built-in Template**:
A Template curated by the Admin and shown in the Gallery. May have a Template Manifest. Stored in D1 and served live by the Worker; the Admin manages it through the Admin Panel, and a successful Save is visible to end users immediately, with no redeploy. Can be unlisted without being deleted — see Listed. (In v1, this was instead a file bundled with the app at build time, hand-edited and shipped via a normal code deploy — no Admin role existed.)
_Avoid_: Starter template, Sample

**Listed**:
A Built-in Template's Listed state controls whether it appears in the public Gallery grid and is reachable at its own Customize URL — an Admin can unlist a Template without deleting it, and the Admin Panel always shows and can edit every Template regardless of Listed state. Defaults to Listed.
_Avoid_: Hidden (reserved for Hidden Parameter — a different, per-variable concept), Visible, Published (this app no longer has a "Published" action — see Save)

**Template Manifest**:
The optional display-override data for a Built-in Template — overriding Control labels, adding a Gallery thumbnail/description, reordering fields, or force-hiding a Parameter — without touching the `.scad` file's own Customizer comments. Only Built-in Templates can have one. It can hide additional Parameters, but can never un-hide a Parameter the `.scad` file itself marked Hidden. Stored as a D1 row's fields, edited through the Admin Panel. (In v1, this was a `template.json` sidecar file instead.)
_Avoid_: Metadata, Config

**Template Image**:
Up to 3 reference images (e.g. photos of a printed result) an Admin can attach to a Built-in Template, beyond its single auto-captured thumbnail. Purely supplementary — reviewed in the Admin Panel as a one-at-a-time carousel with prev/next navigation; not currently shown anywhere in the customer-facing Gallery or Customize view. Stored in R2 (the same bucket as thumbnails and Export Job results) with a D1 row per image recording order.
_Avoid_: Photo, Gallery image (Gallery is a different, existing term — the Template grid screen)

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
Evaluating a Template + Configuration into a Mesh. Always a full evaluation — OpenSCAD Web Management never uses OpenSCAD's fast/approximate "Preview" mode. See [ADR-0001](./docs/adr/0001-always-render-exact-geometry.md). Happens on one of two engines, which now use different geometry backends: the client-side one, in a Web Worker through openscad-wasm on the CGAL backend (unchanged since ADR-0001, kept fast and free by design — see [ADR-0004](./docs/adr/0004-hybrid-client-and-server-rendering.md)); or the server-side one, through native OpenSCAD on the Manifold backend — much faster, at the cost of the two engines being able to disagree on precision-sensitive geometry (see [ADR-0006](./docs/adr/0006-manifold-backend-for-server-side-render.md)). The customer-facing Customize view only ever uses the client-side engine — automatically, unless a Template is estimated likely to hang it (`estimateComplexity`'s `hasExpensiveLoop`), in which case the automatic attempt is skipped and an explicit "Render" button forces it instead. The Admin Panel can trigger either engine at any time, on demand, via two always-available buttons — see Render on server. See [ADR-0007](./docs/adr/0007-skip-then-server-fallback-for-expensive-preview.md), [ADR-0008](./docs/adr/0008-render-on-server-is-admin-only.md), and [ADR-0009](./docs/adr/0009-admin-save-and-export-rework.md).
_Avoid_: Compile, Build, Preview (Preview is a distinct OpenSCAD concept this app deliberately does not use)

**Mesh**:
The triangulated 3D geometry displayed in the Viewer, from whichever Render most recently produced it — the client-side one for a customer, always; for an Admin, whichever of the client-side or server-side engine they last triggered (see Render on server). An Export Job's STL otherwise never touches the Viewer's Mesh even though both come from "the same" Template + Configuration — see Export Job for why they're allowed to diverge slightly regardless.
_Avoid_: Model, Geometry

**Export Job**:
A tracked, asynchronous request for a server-side Render. Moves through `queued` → `rendering` → `done`/`failed`; created by a customer's Export, by an Admin's Render on server, by an Admin's Export, or by an admin script's render-only call. Identical requests (same Template/source + Configuration + format) are deduplicated: a new one reuses a prior done Export Job's result instead of rendering again. Despite the name, not every Export Job backs a download — see Render on server for the one that doesn't. See [ADR-0004](./docs/adr/0004-hybrid-client-and-server-rendering.md), [ADR-0005](./docs/adr/0005-async-export-job-pipeline.md), and [ADR-0009](./docs/adr/0009-admin-save-and-export-rework.md).
_Avoid_: Render job, Task, Queue item

**Render on server**:
The Admin-only action of triggering a server-side Render purely to refresh the Viewer — one of two always-available buttons in the Admin Panel (the other forces the client-side engine instead), regardless of whether the Template is flagged expensive; the customer-facing Customize view never offers this choice (see Render). Backed by the same Export Job pipeline an Export uses (so an identical Configuration hits the same cached result either way), but nothing gets downloaded and no file is offered. The Admin Panel submits raw draft source to `POST /api/admin/render`. Doesn't auto-refresh on further Configuration changes, and a Configuration change falls back to showing the client-side engine's own result — each click is a new, deliberate Export Job, same one-off-action spirit as an Export rather than the continuous free compute of the client-side preview (see ADR-0004).
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
The customer's action of downloading an STL file for the current Configuration — requires a signed-in Account, enforced both in the UI (ExportButton shows "Sign in to export" when signed out) and at `POST /api/export` itself, which 401s an anonymous request. Always goes through a fresh Export Job (a server-side Render via native OpenSCAD) — never a re-export of the Viewer's own client-side Mesh, even though the Viewer is usually already showing the identical result. Not instant: the customer sees the Export Job's progress (queued/rendering) until the file is ready to download. Always STL, always server-side — contrast with the Admin's own, differently-shaped Export.
_Avoid_: Download (Save means something else now — the Admin's action, not this one — see Save; don't use it for this either)

### Administration (v2 only)

**Admin**:
The single authenticated role, gated by Cloudflare Access, that can create, edit, rename, and delete Built-in Templates through the Admin Panel — or, for scripts, through the same Access application using a Service Token instead of an interactive login. Distinct from a customer's optional Account (see Accounts below) — Admin manages the Built-in Template library; an Account only saves a customer's own Designs and has no administrative capability.
_Avoid_: Operator, Curator, Owner, User

**Admin Panel**:
The authenticated part of the app where the Admin manages the Built-in Template library: writing `.scad` source with a live Customizer-parse preview, editing Template Manifest fields, and Saving.
_Avoid_: Dashboard, CMS, Backend

**Save**:
The Admin's action of committing a new or edited Built-in Template so it's visible in the live Gallery — pure metadata persistence (name, description, source, Template Manifest, Listed state, thumbnail), with no Render check first. There is no separate draft or review state: a Template is either Saved — live immediately, however it currently renders or fails to — or not persisted at all. This is a deliberate reversal of the previous "Publish," which blocked on both engines Rendering successfully first (see [ADR-0009](./docs/adr/0009-admin-save-and-export-rework.md) for why, and for what an Admin should do instead to check a Template before Saving it: Render on server / the client-side "Render" button, on demand, whenever). "Save" here is a different action from the customer's own Saved Design (see Accounts below) — disambiguated by what follows the word: bare "Save" is always this Admin action; "Save design"/"Saved Design" is always the customer's.
_Avoid_: Publish (this app no longer has that action — an old ADR or doc referencing "Publish" predates this rename), Upload

**Export** _(Admin)_:
The Admin's own action of downloading the current draft as a file, separate from a customer's Export (see above) in every way that matters: choice of format (STL or 3MF, via a dropdown — 3MF only via the server, since openscad-wasm has no lib3mf compiled in), no Account gate (Admin auth already covers it), and a different routing decision — STL reuses the browser's already-rendered Mesh instantly when there is one (`three`'s `STLExporter`, no server round-trip at all), falling back to a fresh server-side Export Job only when there's no client-side Render to reuse, or when the format is 3MF. Filename is the Template's own name. See [ADR-0009](./docs/adr/0009-admin-save-and-export-rework.md).
_Avoid_: Publish, Download

### Accounts (v2 only)

**Account**:
A free, self-service end-user identity (name, email, password) a customer may optionally create to save their work. Entirely separate from Admin — no billing, no email verification, no "forgot password" in this first version. Login is tracked via an Account session, not Cloudflare Access.
_Avoid_: User, Subscription, Member

**Account session**:
The logged-in state for an Account, held in an httpOnly `account_session` cookie backed by a D1 row. Distinct from the anonymous, unauthenticated session token Export's rate limiting uses (see Export) — that token identifies a browser, not a person, and needs no login; the two never intersect.
_Avoid_: Session (ambiguous with the anonymous export session token — always say "Account session" in full)

**Saved Design**:
A Template + Configuration an Account has explicitly saved, so it survives beyond the browser tab that created it — the persisted counterpart to the otherwise ephemeral Configuration (see Configuration). Saving one never produces a downloadable file — that's Export, a completely separate action.
_Avoid_: Project, Draft (this app has no draft concept — see Save)
