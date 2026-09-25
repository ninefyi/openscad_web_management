import type { Env } from "../../../../../lib/env";
import {
  MAX_TEMPLATE_IMAGES,
  toTemplateImageDTO,
  type TemplateImageRow,
} from "../../../../../lib/templateImages";

export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const templateId = params.id as string;
  const { results } = await env.DB.prepare(
    "SELECT * FROM template_images WHERE template_id = ? ORDER BY position ASC",
  )
    .bind(templateId)
    .all<TemplateImageRow>();
  return Response.json(results.map(toTemplateImageDTO));
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const templateId = params.id as string;

  const template = await env.DB.prepare("SELECT id FROM templates WHERE id = ?")
    .bind(templateId)
    .first();
  if (!template) {
    return Response.json({ error: "Template not found" }, { status: 404 });
  }

  const existing = await env.DB.prepare(
    "SELECT COUNT(*) as n, COALESCE(MAX(position), -1) as maxPosition FROM template_images WHERE template_id = ?",
  )
    .bind(templateId)
    .first<{ n: number; maxPosition: number }>();

  if (!existing || existing.n >= MAX_TEMPLATE_IMAGES) {
    return Response.json(
      { error: `A Template can have at most ${MAX_TEMPLATE_IMAGES} images.` },
      { status: 400 },
    );
  }

  const contentType = request.headers.get("content-type") ?? "application/octet-stream";
  if (!contentType.startsWith("image/")) {
    return Response.json({ error: "Only image uploads are allowed." }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const extension = contentType.split("/")[1]?.split("+")[0] || "bin";
  const r2Key = `template-images/${templateId}/${id}.${extension}`;
  await env.THUMBNAILS.put(r2Key, request.body, { httpMetadata: { contentType } });

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO template_images (id, template_id, r2_key, content_type, position, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, templateId, r2Key, contentType, existing.maxPosition + 1, now)
    .run();

  return Response.json(
    toTemplateImageDTO({
      id,
      template_id: templateId,
      r2_key: r2Key,
      content_type: contentType,
      position: existing.maxPosition + 1,
      created_at: now,
    }),
    { status: 201 },
  );
};
