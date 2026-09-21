# sukjab_scad (v2)

A web app that lets non-technical users customize parametric OpenSCAD models through a generated UI and export the result as an STL file. This is the `v2` branch: the Gallery and Customize view are served live by a Cloudflare Worker backed by D1, and an authenticated Admin manages the Built-in Template library through an Admin Panel. The `v1` branch is the original fully static, backend-less version of the same app and is frozen — its own `CONTEXT.md` describes it as it was.

Rendering itself is unchanged from v1: a Template + Configuration is still evaluated into a Mesh entirely client-side, in the end user's (or Admin's) own browser.

## Language

### Templates & Parameters

**Template**:
A parametric OpenSCAD design (`.scad` source plus its Customizer comments) that the Customize view turns into an editable Mesh. Comes in two kinds: Built-in and Uploaded.
_Avoid_: Model, Design, File

**Built-in Template**:
A Template curated by the Admin and shown in the Gallery. May have a Template Manifest. Stored in D1 and served live by the Worker; the Admin manages it through the Admin Panel, and a successful Publish is visible to end users immediately, with no redeploy. (In v1, this was instead a file bundled with the app at build time, hand-edited and shipped via a normal code deploy — no Admin role existed.)
_Avoid_: Starter template, Sample

**Uploaded Template**:
A Template supplied by the user via file upload, for the current session only. Never has a Template Manifest; its Parameters come from Customizer comments where present and are otherwise Inferred.
_Avoid_: Custom template, User file

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
The Web Worker's evaluation of a Template + Configuration through openscad-wasm into a Mesh. Always a full, exact evaluation — sukjab_scad never uses OpenSCAD's fast/approximate "Preview" mode, so the same Mesh is valid for both the Viewer and Export. See [ADR-0001](./docs/adr/0001-always-render-exact-geometry.md).
_Avoid_: Compile, Build, Preview (Preview is a distinct OpenSCAD concept this app deliberately does not use)

**Mesh**:
The triangulated 3D geometry produced by a Render; consumed directly by both the Viewer and Export.
_Avoid_: Model, Geometry

### Screens & Actions

**Gallery**:
The home screen: a grid of Built-in Template thumbnails plus an entry point to add an Uploaded Template.
_Avoid_: Home, Library, Catalog

**Customize view**:
The screen for a selected Template: the Viewer, the grouped parameter panel of Controls, and the Export action.
_Avoid_: Editor, Customizer (Customizer refers to the OpenSCAD annotation convention, not this screen)

**Viewer**:
The Three.js/@react-three/fiber 3D pane in the Customize view that displays the current Mesh.
_Avoid_: Preview, Canvas

**Export**:
The user action of downloading the current Mesh as an STL file.
_Avoid_: Download, Save

### Administration (v2 only)

**Admin**:
The single authenticated role, gated by Cloudflare Access, that can create, edit, rename, and delete Built-in Templates through the Admin Panel. sukjab_scad has no end-user accounts at all — Admin is the only authenticated identity in the system.
_Avoid_: Operator, Curator, Owner, User

**Admin Panel**:
The authenticated part of the app where the Admin manages the Built-in Template library: writing `.scad` source with a live Customizer-parse preview, editing Template Manifest fields, and Publishing.
_Avoid_: Dashboard, CMS, Backend

**Publish**:
The Admin's action of committing a new or edited Built-in Template so it's visible in the live Gallery. Blocked until the Template Renders successfully in the Admin's own browser, using the same client-side pipeline end users get. There is no separate draft or review state: a Template is either successfully Published — live immediately — or not persisted at all. See [ADR-0002](./docs/adr/0002-admin-validation-runs-client-side.md).
_Avoid_: Save, Save Draft, Upload (Upload is a distinct, unrelated end-user action — see Uploaded Template)
