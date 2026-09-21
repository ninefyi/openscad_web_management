import type { Env } from "../../../../lib/env";

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = params.id as string;

  const existing = await env.DB.prepare("SELECT id FROM templates WHERE id = ?")
    .bind(id)
    .first();
  if (!existing) {
    return Response.json({ error: "Template not found" }, { status: 404 });
  }

  const key = `${id}.png`;
  await env.THUMBNAILS.put(key, request.body, {
    httpMetadata: { contentType: "image/png" },
  });
  await env.DB.prepare("UPDATE templates SET thumbnail_key = ? WHERE id = ?")
    .bind(key, id)
    .run();

  return Response.json({ ok: true });
};
