-- Listed (see CONTEXT.md): whether a Built-in Template appears in the
-- public Gallery and is reachable at its own Customize URL. Defaults to
-- listed so every existing template stays visible after this migration.
-- Unlisting never deletes anything, and the Admin Panel always shows every
-- Template regardless of this flag — only the public-facing endpoints
-- filter on it.
ALTER TABLE templates ADD COLUMN is_listed INTEGER NOT NULL DEFAULT 1;

CREATE INDEX idx_templates_is_listed ON templates (is_listed, updated_at);
