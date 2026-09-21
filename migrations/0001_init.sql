-- Built-in Templates (see CONTEXT.md). Parameters are not stored separately —
-- they're derived from `source` via parseCustomizer, same as v1, so there's
-- one source of truth for what a template's Customizer comments mean.
CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  source TEXT NOT NULL,
  -- Template Manifest fields, each a JSON-encoded value:
  -- manifest_labels: { [paramName]: string }
  -- manifest_order:  string[]
  -- manifest_hide:   string[]
  manifest_labels TEXT NOT NULL DEFAULT '{}',
  manifest_order TEXT NOT NULL DEFAULT '[]',
  manifest_hide TEXT NOT NULL DEFAULT '[]',
  thumbnail_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_templates_updated_at ON templates (updated_at);
