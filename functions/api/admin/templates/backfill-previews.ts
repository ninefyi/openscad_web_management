import type { Env } from "../../../lib/env";
import { warmDefaultPreview } from "../../../lib/jobs";
import type { TemplateRow } from "../../../lib/db";

// One-time (or re-run-anytime) admin action: warm every currently-Listed
// Template's default-preview cache — see docs/adr/0010-cached-default-preview.md.
// Needed because the eager-on-Save trigger alone never reaches a Template
// that isn't re-Saved after this feature ships.
export const onRequestPost: PagesFunction<Env> = async ({ env }) => {
  const { results } = await env.DB.prepare(
    "SELECT id, source FROM templates WHERE is_listed = 1",
  ).all<Pick<TemplateRow, "id" | "source">>();

  for (const row of results) {
    await warmDefaultPreview(env.RENDER_QUEUE, row.id, row.source);
  }

  return Response.json({ warmed: results.length });
};
