import type { Env } from "../../../lib/env";
import { toDetailDTO, type TemplateRow } from "../../../lib/db";

interface UpdatePayload {
  name: string;
  description?: string;
  source: string;
  manifest?: { labels?: Record<string, string>; order?: string[]; hide?: string[] };
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = params.id as string;
  const body = (await request.json()) as UpdatePayload;

  if (!body.name?.trim() || !body.source?.trim()) {
    return Response.json({ error: "name and source are required" }, { status: 400 });
  }

  const existing = await env.DB.prepare("SELECT id FROM templates WHERE id = ?")
    .bind(id)
    .first();
  if (!existing) {
    return Response.json({ error: "Template not found" }, { status: 404 });
  }

  const now = new Date().toISOString();

  await env.DB.prepare(
    `UPDATE templates
     SET name = ?, description = ?, source = ?, manifest_labels = ?, manifest_order = ?, manifest_hide = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      body.name.trim(),
      body.description?.trim() || null,
      body.source,
      JSON.stringify(body.manifest?.labels ?? {}),
      JSON.stringify(body.manifest?.order ?? []),
      JSON.stringify(body.manifest?.hide ?? []),
      now,
      id,
    )
    .run();

  const row = await env.DB.prepare("SELECT * FROM templates WHERE id = ?")
    .bind(id)
    .first<TemplateRow>();

  return Response.json(toDetailDTO(row!));
};

export const onRequestDelete: PagesFunction<Env> = async ({ env, params }) => {
  const id = params.id as string;

  const row = await env.DB.prepare("SELECT thumbnail_key FROM templates WHERE id = ?")
    .bind(id)
    .first<Pick<TemplateRow, "thumbnail_key">>();

  if (!row) {
    return Response.json({ error: "Template not found" }, { status: 404 });
  }

  if (row.thumbnail_key) {
    await env.THUMBNAILS.delete(row.thumbnail_key);
  }
  await env.DB.prepare("DELETE FROM templates WHERE id = ?").bind(id).run();

  return Response.json({ ok: true });
};
