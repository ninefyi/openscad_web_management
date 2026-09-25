-- Template Image (see CONTEXT.md): up to 3 reference/gallery images an
-- Admin can attach to a Built-in Template, beyond the single auto-captured
-- thumbnail (`templates.thumbnail_key`). The 3-image cap is enforced in
-- application code, not a CHECK constraint — same precedent as
-- export_rate_limits, since D1/SQLite predates strict CHECK support.
CREATE TABLE template_images (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES templates(id),
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_template_images_template_id ON template_images (template_id, position);
