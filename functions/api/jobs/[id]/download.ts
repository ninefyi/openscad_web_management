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

  return new Response(object.body, {
    headers: {
      "content-type": "model/stl",
      "content-disposition": `attachment; filename="export-${job.id}.stl"`,
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
};
