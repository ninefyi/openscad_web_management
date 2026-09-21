import type { Env } from "../../lib/env";
import { createJob, sha256Hex, stableConfigString } from "../../lib/jobs";

interface AdminRenderRequest {
  source: string;
  configuration: Record<string, unknown>;
}

/**
 * Admin-only: render raw (possibly not-yet-published) .scad source through
 * the same server-side pipeline customer exports use — no caching (a draft
 * being edited shouldn't return a stale result) and no rate limit (this
 * route is already gated by the admin `_middleware.ts`, either an Access
 * session or a Service Token for scripts).
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as Partial<AdminRenderRequest>;

  if (!body.source?.trim() || !body.configuration) {
    return Response.json({ error: "source and configuration are required" }, { status: 400 });
  }

  const configHash = await sha256Hex(
    `draft:${await sha256Hex(body.source)}:${stableConfigString(body.configuration)}`,
  );

  const jobId = await createJob(env.DB, {
    source: body.source,
    configuration: body.configuration,
    configHash,
  });
  await env.RENDER_QUEUE.send({ jobId });

  return Response.json({ jobId }, { status: 201 });
};
