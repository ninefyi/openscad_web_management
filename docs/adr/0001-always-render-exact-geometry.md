# Always Render exact geometry, never OpenSCAD's fast Preview mode

OpenSCAD Web Management's Web Worker always runs a full, exact openscad-wasm Render for every Configuration change, including for the live Viewer — it never uses OpenSCAD's separate fast/approximate "Preview" mode (OpenCSG-based, what desktop OpenSCAD's editor view uses). This keeps a single Mesh pipeline: the same geometry feeds both the Viewer and STL Export, so the Viewer can never show something that later fails to Export or differs from what gets downloaded.

The trade-off is Render latency on complex Templates (seconds, not milliseconds), absorbed by the debounced Web Worker + loading-state UX rather than by a faster approximate mode. Revisiting this — adding a dual preview/render pipeline — would be a significant rework of the Render/Mesh/Viewer/Export relationship, so it's recorded here rather than left implicit.

(The client engine was CGAL-backed when this was written; [ADR-0011](./0011-client-side-manifold-backend.md) later moved it to Manifold. That's an exact-evaluator swap, not a return to the approximate Preview mode this ADR rules out — the "always exact, never approximate" decision above is unaffected.)
