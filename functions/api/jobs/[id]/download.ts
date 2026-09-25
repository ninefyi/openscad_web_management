import type { Env } from "../../../lib/env";
import { getJob } from "../../../lib/jobs";

export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const id = params.id as string;
  const job = await getJob(env.DB, id);

  if (!job || job.status !== "done" || !job.r2_key) {
    return new Response("Not found", { status: 404 });
  }

  const object = await env.THUMBNAILS.get(job.r2_key);
  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  const format = job.format === "3mf" ? "3mf" : "stl";
  const contentType = format === "3mf" ? "model/3mf" : "model/stl";

  return new Response(object.body, {
    headers: {
      "content-type": contentType,
      // The frontend's own <a download> attribute overrides this filename
      // for a same-origin download (used to give the file the Template's
      // name) — this is just the fallback for a direct link/curl.
      "content-disposition": `attachment; filename="export-${job.id}.${format}"`,
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
};
