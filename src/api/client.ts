import type { Template } from "../types/template";
import { parseCustomizer } from "../customizer/parseCustomizer";
import { applyManifest, type TemplateManifest } from "../templates/applyManifest";

export interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
  hasThumbnail: boolean;
  isListed: boolean;
  updatedAt: string;
}

export interface TemplateDetail extends TemplateSummary {
  source: string;
  manifest: { labels: Record<string, string>; order: string[]; hide: string[] };
}

export async function listBuiltinTemplates(): Promise<TemplateSummary[]> {
  const res = await fetch("/api/templates");
  if (!res.ok) throw new Error("Couldn't load the template gallery.");
  return res.json();
}

export async function fetchTemplateDetail(id: string): Promise<TemplateDetail> {
  const res = await fetch(`/api/templates/${id}`);
  if (!res.ok) throw new Error("That template couldn't be found.");
  return res.json();
}

export function toTemplate(detail: TemplateDetail): Template {
  const manifest: TemplateManifest = {
    name: detail.name,
    description: detail.description ?? undefined,
    labels: detail.manifest.labels,
    order: detail.manifest.order,
    hide: detail.manifest.hide,
  };
  const parsed = parseCustomizer(detail.source);
  return {
    id: detail.id,
    name: detail.name,
    description: detail.description ?? undefined,
    thumbnail: detail.hasThumbnail ? `/api/templates/${detail.id}/thumbnail` : undefined,
    source: detail.source,
    parameters: applyManifest(parsed, manifest),
  };
}

export async function getBuiltinTemplate(id: string): Promise<Template> {
  return toTemplate(await fetchTemplateDetail(id));
}
