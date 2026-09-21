export interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  source: string;
  manifest_labels: string;
  manifest_order: string;
  manifest_hide: string;
  thumbnail_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface TemplateSummaryDTO {
  id: string;
  name: string;
  description: string | null;
  hasThumbnail: boolean;
  updatedAt: string;
}

export interface TemplateDetailDTO extends TemplateSummaryDTO {
  source: string;
  manifest: {
    labels: Record<string, string>;
    order: string[];
    hide: string[];
  };
}

export function toSummaryDTO(row: TemplateRow): TemplateSummaryDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    hasThumbnail: row.thumbnail_key !== null,
    updatedAt: row.updated_at,
  };
}

export function toDetailDTO(row: TemplateRow): TemplateDetailDTO {
  return {
    ...toSummaryDTO(row),
    source: row.source,
    manifest: {
      labels: JSON.parse(row.manifest_labels),
      order: JSON.parse(row.manifest_order),
      hide: JSON.parse(row.manifest_hide),
    },
  };
}

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "template";
}

export async function uniqueSlug(db: D1Database, name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let suffix = 2;
  while (true) {
    const existing = await db
      .prepare("SELECT id FROM templates WHERE id = ?")
      .bind(candidate)
      .first();
    if (!existing) return candidate;
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}
