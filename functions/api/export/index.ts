import type { Env } from "../../lib/env";
import type { TemplateRow } from "../../lib/db";
import { loadAccountFromRequest } from "../../lib/accountSession";
import {
  createJob,
  findCachedJob,
  sha256Hex,
  stableConfigString,
  type ExportFormat,
} from "../../lib/jobs";
import { checkExportRateLimit } from "../../lib/rateLimit";

interface ExportRequest {
  templateId: string;
  configuration: Record<string, unknown>;
  sessionToken: string;
  format?: ExportFormat;
}

const VALID_FORMATS: ExportFormat[] = ["stl", "3mf"];

// Requires a signed-in Account (see CONTEXT.md: Export). A customer whose
// Template Renders too expensive for the browser gets an explicit,
// client-side "Render" button instead — server-side preview is Admin-only
// (see CONTEXT.md: Render on server), so there's no anonymous caller of
// this job-submission logic to share it with anymore.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const account = await loadAccountFromRequest(request, env.DB);
  if (!account) {
    return Response.json({ error: "Sign in to export." }, { status: 401 });
  }

  const body = (await request.json()) as Partial<ExportRequest>;
  if (!body.templateId || !body.configuration || !body.sessionToken) {
    return Response.json(
      { error: "templateId, configuration, and sessionToken are required" },
      { status: 400 },
    );
  }

  const allowed = await checkExportRateLimit(env.DB, body.sessionToken);
  if (!allowed) {
    return Response.json(
      { error: "Too many exports — please wait a minute and try again." },
      { status: 429 },
    );
  }

  const format = body.format ?? "stl";
  if (!VALID_FORMATS.includes(format)) {
    return Response.json(
      { error: `format must be one of: ${VALID_FORMATS.join(", ")}` },
      { status: 400 },
    );
  }

  const template = await env.DB.prepare("SELECT * FROM templates WHERE id = ?")
    .bind(body.templateId)
    .first<TemplateRow>();
  if (!template) {
    return Response.json({ error: "Template not found" }, { status: 404 });
  }

  // STL keeps its original key so already-cached STL jobs stay reusable; a
  // 3MF of the same Configuration is a different output and gets its own.
  const baseKey = `${template.id}:${template.updated_at}:${stableConfigString(body.configuration)}`;
  const configHash = await sha256Hex(format === "stl" ? baseKey : `${baseKey}:${format}`);

  // One per accepted Export click, cached or not (see CONTEXT.md: Download
  // Count). Deliberately leaves updated_at alone — it orders the Gallery.
  const countDownload = () =>
    env.DB.prepare("UPDATE templates SET download_count = download_count + 1 WHERE id = ?")
      .bind(template.id)
      .run();

  const cached = await findCachedJob(env.DB, configHash);
  if (cached) {
    await countDownload();
    return Response.json({ jobId: cached.id, cached: true });
  }

  const jobId = await createJob(env.DB, {
    templateId: template.id,
    configuration: body.configuration,
    configHash,
    format,
  });
  await env.RENDER_QUEUE.send({ jobId });
  await countDownload();

  return Response.json({ jobId, cached: false }, { status: 201 });
};
