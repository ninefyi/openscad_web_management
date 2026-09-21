import { Container, getRandom } from "@cloudflare/containers";

export class RenderContainer extends Container {
  defaultPort = 8080;
  // Renders are bursty, not constant — no reason to keep a container warm
  // between them for long.
  sleepAfter = "2m";
}

interface Env {
  RENDER_CONTAINER: DurableObjectNamespace<RenderContainer>;
  DB: D1Database;
  THUMBNAILS: R2Bucket;
}

interface QueueMessage {
  jobId: string;
}

interface ExportJobRow {
  id: string;
  template_id: string | null;
  source: string | null;
  configuration: string;
}

interface TemplateRow {
  source: string;
}

function serializeConfigValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.join(",")}]`;
  if (typeof value === "string") {
    // A raw vector re-entered as text (the parser's unsupported-vector
    // fallback) already looks like "[1, 0, 0]" — pass it through as-is
    // rather than JSON-quoting it into an invalid OpenSCAD literal.
    if (value.trim().startsWith("[")) return value.trim();
    return JSON.stringify(value);
  }
  return JSON.stringify(value);
}

/** The frontend already excludes Hidden Parameters before submitting a
 * job (it's the only place that has the parsed Parameter list with the
 * `hidden` flag) — this just serializes whatever keys it was given. */
function buildDefines(configuration: Record<string, unknown>): string[] {
  return Object.entries(configuration).map(
    ([name, value]) => `${name}=${serializeConfigValue(value)}`,
  );
}

async function updateJob(
  db: D1Database,
  jobId: string,
  fields: { status: string; r2_key?: string; error?: string },
): Promise<void> {
  await db
    .prepare(
      "UPDATE export_jobs SET status = ?, r2_key = COALESCE(?, r2_key), error = ?, updated_at = ? WHERE id = ?",
    )
    .bind(fields.status, fields.r2_key ?? null, fields.error ?? null, new Date().toISOString(), jobId)
    .run();
}

async function processJob(jobId: string, env: Env): Promise<void> {
  const job = await env.DB.prepare("SELECT * FROM export_jobs WHERE id = ?")
    .bind(jobId)
    .first<ExportJobRow>();
  if (!job) return;

  await updateJob(env.DB, jobId, { status: "rendering" });

  try {
    let source = job.source;
    if (!source) {
      const template = await env.DB.prepare("SELECT source FROM templates WHERE id = ?")
        .bind(job.template_id)
        .first<TemplateRow>();
      if (!template) throw new Error("Template no longer exists");
      source = template.source;
    }

    const configuration = JSON.parse(job.configuration) as Record<string, unknown>;
    const defines = buildDefines(configuration);

    // Stateless render request — load-balance across whichever container
    // instances are available rather than pinning to one by name.
    const container = await getRandom(env.RENDER_CONTAINER, 3);
    const response = await container.fetch("http://container/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source, defines }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Container returned HTTP ${response.status}`);
    }

    const stl = await response.arrayBuffer();
    const r2Key = `exports/${jobId}.stl`;
    await env.THUMBNAILS.put(r2Key, stl, { httpMetadata: { contentType: "model/stl" } });

    await updateJob(env.DB, jobId, { status: "done", r2_key: r2Key });
  } catch (err) {
    await updateJob(env.DB, jobId, {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export default {
  // This Worker has no public HTTP surface of its own — it's driven
  // entirely by the queue consumer below.
  async fetch() {
    return new Response("openscad-render-worker: internal service", { status: 200 });
  },

  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      await processJob(message.body.jobId, env);
      message.ack();
    }
  },
};
