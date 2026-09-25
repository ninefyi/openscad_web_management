-- Export format (see CONTEXT.md: Export Job) — 'stl' or '3mf'. Defaults to
-- 'stl' so every existing/future customer Export Job (still STL-only) and
-- Admin server Render need no change; only the Admin's new format-choosing
-- Export path ever sets it to '3mf'. Baked into config_hash at the call
-- site rather than given its own index — an STL and a 3MF Export Job for
-- the same (source|template, Configuration) are different render outputs
-- and must not share a cached result.
ALTER TABLE export_jobs ADD COLUMN format TEXT NOT NULL DEFAULT 'stl';
