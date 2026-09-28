# The Admin Panel's preview re-renders only on an explicit click, same as the customer view

[ADR-0013](./0013-explicit-render-trigger.md) moved the customer-facing Customize view to explicit-click Render but deliberately left the Admin Panel auto-rendering on every Configuration change and every source keystroke, citing [ADR-0009](./0009-admin-save-and-export-rework.md)'s "an Admin always wants a current result." That exception is reversed: in the Admin Panel, editing Parameter values *or* the OpenSCAD source never triggers a Render on its own — only clicking "Render (browser)" or "Render (server)" does. Both engines follow one rule: whatever was rendered last stays on screen, marked stale until either button is clicked again. A Configuration change no longer switches the Viewer back from a server result to the client-side one. The first paint after opening an existing Template still happens automatically, same as the customer view, including the default-preview cache race from [ADR-0010](./0010-cached-default-preview.md). An "always current" preview turned out to cost more than it gave while iterating on a heavy draft: every keystroke in the source box kicked off a fresh openscad-wasm evaluation of a half-typed file.

## Consequences

"Current" is now a property the Admin Panel has to check rather than assume, and two actions that used to rely on it change accordingly:

- **Admin Export (STL)** reuses the browser's Mesh only when that Mesh matches the current source and Configuration. Otherwise it falls back to a fresh server-side Export Job, so the file always matches what's configured, not what's on screen.
- **Save** still never waits on a Render (ADR-0009 stands). But it only uploads a new Gallery thumbnail when the Viewer's Mesh is current. If the Viewer is stale, Save keeps the previous thumbnail and tells the Admin to click Render and Save again, so a thumbnail never shows a different design than the Saved source.

Both Render buttons stay clickable at all times, even with nothing changed, as ADR-0009 set out. A repeat click re-shows the existing result instead of computing again, which lets an Admin flip between the two engines' output for the same draft.
