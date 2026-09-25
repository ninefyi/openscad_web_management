import type { Env } from "../../lib/env";
import type { TemplateRow } from "../../lib/db";
import { loadAccountFromRequest } from "../../lib/accountSession";
import {
  createJob,
  findCachedJob,
  sha256Hex,
  stableConfigString,
} from "../../lib/jobs";
import { checkExportRateLimit } from "../../lib/rateLimit";

interface ExportRequest {
  templateId: string;
  configuration: Record<string, unknown>;
  sessionToken: string;
}

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

  const template = await env.DB.prepare("SELECT * FROM templates WHERE id = ?")
    .bind(body.templateId)
    .first<TemplateRow>();
  if (!template) {
    return Response.json({ error: "Template not found" }, { status: 404 });
  }

  const configHash = await sha256Hex(
    `${template.id}:${template.updated_at}:${stableConfigString(body.configuration)}`,
  );

  const cached = await findCachedJob(env.DB, configHash);
  if (cached) {
    return Response.json({ jobId: cached.id, cached: true });
  }

  const jobId = await createJob(env.DB, {
    templateId: template.id,
    configuration: body.configuration,
    configHash,
  });
  await env.RENDER_QUEUE.send({ jobId });

  return Response.json({ jobId, cached: false }, { status: 201 });
};
