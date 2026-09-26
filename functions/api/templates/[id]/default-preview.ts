import type { Env } from "../../../lib/env";

// Serves a Template's precomputed default-Configuration Mesh (see
// docs/adr/0010-cached-default-preview.md) — a fixed R2 key, so there's
// nothing to look up in D1 beyond confirming the Template is reachable at
// all. 404 covers both "never warmed yet" and "doesn't exist/unlisted"
// identically; useRenderMesh treats any non-200 as a plain cache miss and
// falls back to its normal client-side Render.
export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const id = params.id as string;

  const template = await env.DB.prepare("SELECT is_listed FROM templates WHERE id = ?")
    .bind(id)
    .first<{ is_listed: number }>();
  if (!template || template.is_listed !== 1) {
    return new Response("Not found", { status: 404 });
  }

  const object = await env.THUMBNAILS.get(`default-preview/${id}.stl`);
  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(object.body, {
    headers: {
      "content-type": "model/stl",
      "cache-control": "public, max-age=60",
    },
  });
};
