import type { Configuration, Parameter } from "../types/template";

const SESSION_TOKEN_KEY = "openscad-web-management.sessionToken";
const POLL_INTERVAL_MS = 1500;
const CLIENT_POLL_CEILING_MS = 5 * 60 * 1000;

export interface JobStatusResponse {
  id: string;
  status: "queued" | "rendering" | "done" | "failed";
  error: string | null;
  aheadInQueue: number;
  downloadUrl: string | null;
}

/** A random per-browser identity for the export rate limit (see CONTEXT.md)
 * — not an account, just enough to catch one runaway session. Generated
 * once and reused; safe to reset by clearing site data. */
export function getSessionToken(): string {
  try {
    const existing = localStorage.getItem(SESSION_TOKEN_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    localStorage.setItem(SESSION_TOKEN_KEY, fresh);
    return fresh;
  } catch {
    // Private browsing / blocked storage — a per-call random token still
    // lets the request through, it just won't be rate-limited consistently.
    return crypto.randomUUID();
  }
}

/** Hidden Parameters are never user-editable — the source's own default
 * always applies, exactly like the client-side render pipeline already
 * treats them (see useRenderMesh's buildDefines). Submitting them here too
 * would risk a Q1-style parity break between what the customer previewed
 * and what the server renders. */
export function visibleConfiguration(
  parameters: Parameter[],
  configuration: Configuration,
): Record<string, Configuration[string]> {
  const visible: Record<string, Configuration[string]> = {};
  for (const p of parameters) {
    if (!p.hidden) visible[p.name] = configuration[p.name] ?? p.defaultValue;
  }
  return visible;
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "Request failed");
  return body;
}

export async function submitExport(
  templateId: string,
  configuration: Record<string, Configuration[string]>,
): Promise<{ jobId: string }> {
  const res = await fetch("/api/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ templateId, configuration, sessionToken: getSessionToken() }),
  });
  return parseJsonOrThrow<{ jobId: string }>(res);
}

export type ExportFormat = "stl" | "3mf";

export async function submitAdminRender(
  source: string,
  configuration: Record<string, Configuration[string]>,
  format?: ExportFormat,
): Promise<{ jobId: string }> {
  const res = await fetch("/api/admin/render", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source, configuration, format }),
  });
  return parseJsonOrThrow<{ jobId: string }>(res);
}

export async function pollJob(jobId: string): Promise<JobStatusResponse> {
  const res = await fetch(`/api/jobs/${jobId}`);
  return parseJsonOrThrow<JobStatusResponse>(res);
}

/** Polls until the job reaches done/failed (or a client-side ceiling, as a
 * safety net alongside the server's own — see QUEUE_CEILING_MS), invoking
 * onUpdate after every poll so the caller can show progress in between. */
export async function pollUntilSettled(
  jobId: string,
  onUpdate: (status: JobStatusResponse) => void,
): Promise<JobStatusResponse> {
  const startedAt = Date.now();
  while (true) {
    const status = await pollJob(jobId);
    onUpdate(status);
    if (status.status === "done" || status.status === "failed") return status;
    if (Date.now() - startedAt > CLIENT_POLL_CEILING_MS) {
      return {
        ...status,
        status: "failed",
        error: "This is taking longer than expected — please try again.",
      };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
