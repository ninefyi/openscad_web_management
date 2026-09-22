import type { Env } from "./env";
import type { TemplateRow } from "./db";
import { createJob, findCachedJob, sha256Hex, stableConfigString } from "./jobs";
import { checkExportRateLimit } from "./rateLimit";

export type SubmitJobResult =
  | { ok: true; jobId: string; cached: boolean }
  | { ok: false; status: number; error: string };

/** The Export Job submission shared by POST /api/export (requires an
 * Account) and POST /api/preview (anonymous — Render on server, see
 * CONTEXT.md). Identical (templateId, configuration) hits the same cached
 * job either way, so an anonymous preview and a later real Export of the
 * same Configuration don't render twice. */
export async function submitTemplateJob(
  env: Env,
  templateId: string,
  configuration: Record<string, unknown>,
  sessionToken: string,
): Promise<SubmitJobResult> {
  const allowed = await checkExportRateLimit(env.DB, sessionToken);
  if (!allowed) {
    return {
      ok: false,
      status: 429,
      error: "Too many exports — please wait a minute and try again.",
    };
  }

  const template = await env.DB.prepare("SELECT * FROM templates WHERE id = ?")
    .bind(templateId)
    .first<TemplateRow>();
  if (!template) {
    return { ok: false, status: 404, error: "Template not found" };
  }

  const configHash = await sha256Hex(
    `${template.id}:${template.updated_at}:${stableConfigString(configuration)}`,
  );

  const cached = await findCachedJob(env.DB, configHash);
  if (cached) {
    return { ok: true, jobId: cached.id, cached: true };
  }

  const jobId = await createJob(env.DB, { templateId: template.id, configuration, configHash });
  await env.RENDER_QUEUE.send({ jobId });

  return { ok: true, jobId, cached: false };
}
