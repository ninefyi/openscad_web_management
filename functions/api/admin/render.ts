import type { Env } from "../../lib/env";
import { createJob, sha256Hex, stableConfigString, type ExportFormat } from "../../lib/jobs";

interface AdminRenderRequest {
  source: string;
  configuration: Record<string, unknown>;
  format?: ExportFormat;
}

const VALID_FORMATS: ExportFormat[] = ["stl", "3mf"];

/**
 * Admin-only: render raw (possibly not-yet-published) .scad source through
 * the same server-side pipeline customer exports use — no caching (a draft
 * being edited shouldn't return a stale result) and no rate limit (this
 * route is already gated by the admin `_middleware.ts`, either an Access
 * session or a Service Token for scripts). Used both for the "Render
 * (server)" preview and for the Admin's own Export (STL or 3MF) — the
 * format is baked into the hash so the two never share a cached job.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as Partial<AdminRenderRequest>;

  if (!body.source?.trim() || !body.configuration) {
    return Response.json({ error: "source and configuration are required" }, { status: 400 });
  }

  const format = body.format ?? "stl";
  if (!VALID_FORMATS.includes(format)) {
    return Response.json({ error: `format must be one of: ${VALID_FORMATS.join(", ")}` }, { status: 400 });
  }

  const configHash = await sha256Hex(
    `draft:${await sha256Hex(body.source)}:${format}:${stableConfigString(body.configuration)}`,
  );

  const jobId = await createJob(env.DB, {
    source: body.source,
    configuration: body.configuration,
    configHash,
    format,
  });
  await env.RENDER_QUEUE.send({ jobId });

  return Response.json({ jobId }, { status: 201 });
};
