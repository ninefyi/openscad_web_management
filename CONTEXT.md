# sukjab_scad

A static, client-side web app that lets non-technical users customize parametric OpenSCAD models through a generated UI and export the result as an STL file.

## Language

### Templates & Parameters

**Template**:
A parametric OpenSCAD design (`.scad` source plus its Customizer comments) that the Customize view turns into an editable Mesh. Every Template is a Built-in Template — end users can only browse and customize what the app operator has bundled, they can't supply their own `.scad` file (that end-user upload path existed early on and was removed; see git history if it's ever wanted back).
_Avoid_: Model, Design, File

**Built-in Template**:
A Template curated by the app operator, bundled with the app, and shown in the Gallery. May ship with a Template Manifest.
_Avoid_: Starter template, Sample

**Template Manifest**:
An optional JSON sidecar (`template.json`) for a Built-in Template that overrides Control labels, adds a Gallery thumbnail/description, reorders fields, or force-hides a Parameter — without touching the `.scad` file's own Customizer comments. Only Built-in Templates can have one. It can hide additional Parameters, but can never un-hide a Parameter the `.scad` file itself marked Hidden.
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
The home screen: a grid of Built-in Template thumbnails.
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
