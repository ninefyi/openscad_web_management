import type { TemplateDetail } from "./client";

export interface TemplateInput {
  name: string;
  description?: string;
  source: string;
  manifest: { labels: Record<string, string>; order: string[]; hide: string[] };
}

async function parseOrThrow(res: Response): Promise<TemplateDetail> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? "Request failed");
  }
  return res.json();
}

export async function createTemplate(input: TemplateInput): Promise<TemplateDetail> {
  const res = await fetch("/api/admin/templates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseOrThrow(res);
}

export async function updateTemplate(
  id: string,
  input: TemplateInput,
): Promise<TemplateDetail> {
  const res = await fetch(`/api/admin/templates/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseOrThrow(res);
}

export async function deleteTemplate(id: string): Promise<void> {
  const res = await fetch(`/api/admin/templates/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Couldn't delete this template.");
}

export async function uploadThumbnail(id: string, png: Blob): Promise<void> {
  const res = await fetch(`/api/admin/templates/${id}/thumbnail`, {
    method: "PUT",
    headers: { "content-type": "image/png" },
    body: png,
  });
  if (!res.ok) throw new Error("Couldn't save the thumbnail.");
}
