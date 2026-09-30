-- Download count (see CONTEXT.md: Download Count): how many times customers
-- have exported a Template, shown on its Gallery card. Bumped once per
-- accepted customer Export request in POST /api/export, including one served
-- from the cached-job shortcut — counting export_jobs rows would miss those.
-- Never touches updated_at, which orders the Gallery.
ALTER TABLE templates ADD COLUMN download_count INTEGER NOT NULL DEFAULT 0;

-- Starting point for Templates exported before this column existed: one per
-- finished customer job. A lower bound — cached re-exports left no trace.
UPDATE templates
SET download_count = (
  SELECT COUNT(*) FROM export_jobs
  WHERE export_jobs.template_id = templates.id AND export_jobs.status = 'done'
);
