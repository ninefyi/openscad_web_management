import type { Env } from "../../../../../lib/env";
import type { TemplateImageRow } from "../../../../../lib/templateImages";

export const onRequestDelete: PagesFunction<Env> = async ({ env, params }) => {
  const templateId = params.id as string;
  const imageId = params.imageId as string;

  const row = await env.DB.prepare(
    "SELECT * FROM template_images WHERE id = ? AND template_id = ?",
  )
    .bind(imageId, templateId)
    .first<TemplateImageRow>();
  if (!row) {
    return Response.json({ error: "Image not found" }, { status: 404 });
  }

  await env.THUMBNAILS.delete(row.r2_key);
  await env.DB.prepare("DELETE FROM template_images WHERE id = ?").bind(imageId).run();

  return Response.json({ ok: true });
};
