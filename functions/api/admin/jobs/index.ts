import type { Env } from "../../../lib/env";
import type { ExportJobRow } from "../../../lib/jobs";

// Admin-only visibility into every Export Job (customer Export, Admin
// Render on server/Export, default-preview warm jobs) regardless of
// status — most recent first. No pagination yet: fine at this project's
// current scale, revisit if the table grows enough to matter.
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const { results } = await env.DB.prepare(
    "SELECT id, template_id, status, format, error, r2_key, created_at, updated_at FROM export_jobs ORDER BY created_at DESC LIMIT 100",
  ).all<
    Pick<
      ExportJobRow,
      "id" | "template_id" | "status" | "format" | "error" | "r2_key" | "created_at" | "updated_at"
    >
  >();
  return Response.json(results);
};

interface DeletePayload {
  ids: string[];
}

// Deletes both the D1 row and its R2 object (if any) — same cleanup a done
// job's r2_key would otherwise leave behind forever. Deleting a still
// in-progress (queued/rendering) job is allowed but doesn't cancel it: the
// render-worker Container keeps processing the Queue message regardless,
// it just has nowhere left to write its result (see CONTEXT.md: Export Job).
export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as Partial<DeletePayload>;
  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return Response.json({ error: "ids is required" }, { status: 400 });
  }

  const placeholders = body.ids.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT id, r2_key FROM export_jobs WHERE id IN (${placeholders})`,
  )
    .bind(...body.ids)
    .all<Pick<ExportJobRow, "id" | "r2_key">>();

  await Promise.all(results.filter((r) => r.r2_key).map((r) => env.THUMBNAILS.delete(r.r2_key!)));
  await env.DB.prepare(`DELETE FROM export_jobs WHERE id IN (${placeholders})`)
    .bind(...body.ids)
    .run();

  return Response.json({ deleted: results.length });
};
