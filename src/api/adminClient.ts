import type { TemplateDetail, TemplateSummary } from "./client";

export interface TemplateInput {
  name: string;
  description?: string;
  source: string;
  isListed?: boolean;
  manifest: { labels: Record<string, string>; order: string[]; hide: string[] };
}

async function parseOrThrow(res: Response): Promise<TemplateDetail> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? "Request failed");
  }
  return res.json();
}

// Unlike listBuiltinTemplates/fetchTemplateDetail in ./client (the public,
// Listed-filtered endpoints — see CONTEXT.md: Listed), these always show
// every Template regardless of Listed state, which is what the Admin Panel
// needs.
export async function listAdminTemplates(): Promise<TemplateSummary[]> {
  const res = await fetch("/api/admin/templates");
  if (!res.ok) throw new Error("Couldn't load templates.");
  return res.json();
}

export async function fetchAdminTemplateDetail(id: string): Promise<TemplateDetail> {
  const res = await fetch(`/api/admin/templates/${id}`);
  if (!res.ok) throw new Error("That template couldn't be found.");
  return res.json();
}

export async function setTemplateListed(
  id: string,
  isListed: boolean,
): Promise<TemplateDetail> {
  const res = await fetch(`/api/admin/templates/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ isListed }),
  });
  return parseOrThrow(res);
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

export interface TemplateImage {
  id: string;
  url: string;
  position: number;
}

export async function listTemplateImages(templateId: string): Promise<TemplateImage[]> {
  const res = await fetch(`/api/admin/templates/${templateId}/images`);
  if (!res.ok) throw new Error("Couldn't load images.");
  return res.json();
}

export async function uploadTemplateImage(
  templateId: string,
  file: Blob,
): Promise<TemplateImage> {
  const res = await fetch(`/api/admin/templates/${templateId}/images`, {
    method: "POST",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Couldn't upload this image." }));
    throw new Error(body.error ?? "Couldn't upload this image.");
  }
  return res.json();
}

export async function deleteTemplateImage(templateId: string, imageId: string): Promise<void> {
  const res = await fetch(`/api/admin/templates/${templateId}/images/${imageId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Couldn't delete this image.");
}
