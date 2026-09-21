-- Export Job: an async server-side Render request (see CONTEXT.md), tracked
-- through queued -> rendering -> done|failed. Created either from an
-- existing Built-in Template (customer export) or from raw draft source
-- (Admin Publish validation / admin scripts) — exactly one of
-- template_id/source is set, enforced in application code rather than a
-- CHECK constraint, since D1 predates strict CHECK support.
CREATE TABLE export_jobs (
  id TEXT PRIMARY KEY,
  template_id TEXT,
  source TEXT,
  configuration TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  r2_key TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Export caching (see CONTEXT.md: config_hash) — find a completed job for
-- the same template+configuration before queuing a fresh render.
CREATE INDEX idx_export_jobs_hash ON export_jobs (config_hash, status);

-- Per-browser-session export rate limiting — a fixed window counter, reset
-- by simply overwriting window_start once it's stale (checked in code).
CREATE TABLE export_rate_limits (
  session_token TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL
);
