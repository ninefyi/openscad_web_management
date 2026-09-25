export type JobStatus = "queued" | "rendering" | "done" | "failed";

export type ExportFormat = "stl" | "3mf";

export interface ExportJobRow {
  id: string;
  template_id: string | null;
  source: string | null;
  configuration: string;
  config_hash: string;
  status: JobStatus;
  r2_key: string | null;
  error: string | null;
  format: ExportFormat;
  created_at: string;
  updated_at: string;
}

export interface QueueMessage {
  jobId: string;
}

/** A queued/rendering job older than this is stale — the consumer fails it
 * without rendering rather than burning container time on a request the
 * caller has likely already given up polling for. */
export const QUEUE_CEILING_MS = 5 * 60 * 1000;

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Order-independent so the same Configuration always hashes the same way
 * regardless of key insertion order. */
export function stableConfigString(configuration: Record<string, unknown>): string {
  const keys = Object.keys(configuration).sort();
  return JSON.stringify(keys.map((k) => [k, configuration[k]]));
}

export async function findCachedJob(
  db: D1Database,
  configHash: string,
): Promise<ExportJobRow | null> {
  return db
    .prepare(
      "SELECT * FROM export_jobs WHERE config_hash = ? AND status = 'done' ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(configHash)
    .first<ExportJobRow>();
}

export async function createJob(
  db: D1Database,
  input: {
    templateId?: string;
    source?: string;
    configuration: Record<string, unknown>;
    configHash: string;
    format?: ExportFormat;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO export_jobs
        (id, template_id, source, configuration, config_hash, status, format, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
    )
    .bind(
      id,
      input.templateId ?? null,
      input.source ?? null,
      JSON.stringify(input.configuration),
      input.configHash,
      input.format ?? "stl",
      now,
      now,
    )
    .run();
  return id;
}

export async function getJob(db: D1Database, id: string): Promise<ExportJobRow | null> {
  return db.prepare("SELECT * FROM export_jobs WHERE id = ?").bind(id).first<ExportJobRow>();
}

/** Jobs still ahead of this one in the queue — a D1-based approximation of
 * queue position (Cloudflare Queues doesn't expose real introspection to
 * consumers), used only for "N ahead of you" progress messaging. */
export async function queuePositionAhead(db: D1Database, job: ExportJobRow): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) as n FROM export_jobs WHERE status IN ('queued','rendering') AND created_at < ?",
    )
    .bind(job.created_at)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
