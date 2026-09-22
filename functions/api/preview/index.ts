import type { Env } from "../../lib/env";
import { submitTemplateJob } from "../../lib/exportSubmission";

interface PreviewRequest {
  templateId: string;
  configuration: Record<string, unknown>;
  sessionToken: string;
}

// Anonymous, deliberately — this backs Render on server (see CONTEXT.md),
// the public Customize view's fallback for a Template too expensive to
// preview client-side. It shares submitTemplateJob's Export Job pipeline
// with POST /api/export (so the same Configuration hits the same cache
// either way) but never requires an Account: gating this the same as
// Export would also block anonymous visitors from previewing a complex
// design at all, which is a different feature than Export and wasn't
// what login-gating Export was meant to restrict.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as Partial<PreviewRequest>;
  if (!body.templateId || !body.configuration || !body.sessionToken) {
    return Response.json(
      { error: "templateId, configuration, and sessionToken are required" },
      { status: 400 },
    );
  }

  const result = await submitTemplateJob(
    env,
    body.templateId,
    body.configuration,
    body.sessionToken,
  );
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json(
    { jobId: result.jobId, cached: result.cached },
    { status: result.cached ? 200 : 201 },
  );
};
