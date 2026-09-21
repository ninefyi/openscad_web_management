import type { Env } from "../../../lib/env";
import type { TemplateRow } from "../../../lib/db";

export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const id = params.id as string;
  const row = await env.DB.prepare("SELECT thumbnail_key FROM templates WHERE id = ?")
    .bind(id)
    .first<Pick<TemplateRow, "thumbnail_key">>();

  if (!row?.thumbnail_key) {
    return new Response("Not found", { status: 404 });
  }

  const object = await env.THUMBNAILS.get(row.thumbnail_key);
  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "image/png",
      "cache-control": "public, max-age=3600",
    },
  });
};
