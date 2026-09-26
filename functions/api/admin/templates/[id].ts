import type { Env } from "../../../lib/env";
import { toDetailDTO, type TemplateRow } from "../../../lib/db";
import { warmDefaultPreview } from "../../../lib/jobs";

interface UpdatePayload {
  name: string;
  description?: string;
  source: string;
  isListed?: boolean;
  manifest?: { labels?: Record<string, string>; order?: string[]; hide?: string[] };
}

interface ListedPayload {
  isListed: boolean;
}

// Unfiltered — the Admin Panel can load and edit an unlisted Template.
export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const id = params.id as string;
  const row = await env.DB.prepare("SELECT * FROM templates WHERE id = ?")
    .bind(id)
    .first<TemplateRow>();
  if (!row) {
    return Response.json({ error: "Template not found" }, { status: 404 });
  }
  return Response.json(toDetailDTO(row));
};

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
     SET name = ?, description = ?, source = ?, manifest_labels = ?, manifest_order = ?, manifest_hide = ?, is_listed = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      body.name.trim(),
      body.description?.trim() || null,
      body.source,
      JSON.stringify(body.manifest?.labels ?? {}),
      JSON.stringify(body.manifest?.order ?? []),
      JSON.stringify(body.manifest?.hide ?? []),
      body.isListed === false ? 0 : 1,
      now,
      id,
    )
    .run();

  const row = await env.DB.prepare("SELECT * FROM templates WHERE id = ?")
    .bind(id)
    .first<TemplateRow>();

  if (row!.is_listed === 1) {
    await warmDefaultPreview(env.RENDER_QUEUE, id, body.source);
  }

  return Response.json(toDetailDTO(row!));
};

// A lighter-weight toggle for AdminList's quick action — doesn't require
// resending the full source/manifest just to flip one flag.
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = params.id as string;
  const body = (await request.json()) as ListedPayload;
  const now = new Date().toISOString();

  const result = await env.DB.prepare(
    "UPDATE templates SET is_listed = ?, updated_at = ? WHERE id = ?",
  )
    .bind(body.isListed ? 1 : 0, now, id)
    .run();

  if (result.meta.changes === 0) {
    return Response.json({ error: "Template not found" }, { status: 404 });
  }

  const row = await env.DB.prepare("SELECT * FROM templates WHERE id = ?")
    .bind(id)
    .first<TemplateRow>();

  // Re-listing (isListed: false -> true) is the one PATCH case that needs a
  // fresh cache — unlisting doesn't need to clear it (unreachable either way).
  if (body.isListed && row!.is_listed === 1) {
    await warmDefaultPreview(env.RENDER_QUEUE, id, row!.source);
  }

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
