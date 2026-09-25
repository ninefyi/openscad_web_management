import type { Env } from "../../../../lib/env";
import type { TemplateImageRow } from "../../../../lib/templateImages";

// Public, same precedent as the Built-in Template thumbnail route — a
// media file's own serve route isn't gated on the Template's Listed state
// (see CONTEXT.md: Listed), unlike the Template's own detail/list.
export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const templateId = params.id as string;
  const imageId = params.imageId as string;

  const row = await env.DB.prepare(
    "SELECT * FROM template_images WHERE id = ? AND template_id = ?",
  )
    .bind(imageId, templateId)
    .first<TemplateImageRow>();
  if (!row) {
    return new Response("Not found", { status: 404 });
  }

  const object = await env.THUMBNAILS.get(row.r2_key);
  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(object.body, {
    headers: {
      "content-type": row.content_type,
      "cache-control": "public, max-age=3600",
    },
  });
};
