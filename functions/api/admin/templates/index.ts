import type { Env } from "../../../lib/env";
import { toDetailDTO, toSummaryDTO, uniqueSlug, type TemplateRow } from "../../../lib/db";

interface CreatePayload {
  name: string;
  description?: string;
  source: string;
  isListed?: boolean;
  manifest?: { labels?: Record<string, string>; order?: string[]; hide?: string[] };
}

// Unfiltered — unlike the public GET /api/templates, the Admin Panel always
// sees every Template regardless of Listed state (see CONTEXT.md: Listed).
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const { results } = await env.DB.prepare(
    "SELECT * FROM templates ORDER BY updated_at DESC",
  ).all<TemplateRow>();
  return Response.json(results.map(toSummaryDTO));
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as CreatePayload;

  if (!body.name?.trim() || !body.source?.trim()) {
    return Response.json({ error: "name and source are required" }, { status: 400 });
  }

  const id = await uniqueSlug(env.DB, body.name);
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO templates
      (id, name, description, source, manifest_labels, manifest_order, manifest_hide, thumbnail_key, is_listed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
  )
    .bind(
      id,
      body.name.trim(),
      body.description?.trim() || null,
      body.source,
      JSON.stringify(body.manifest?.labels ?? {}),
      JSON.stringify(body.manifest?.order ?? []),
      JSON.stringify(body.manifest?.hide ?? []),
      body.isListed === false ? 0 : 1,
      now,
      now,
    )
    .run();

  const row = await env.DB.prepare("SELECT * FROM templates WHERE id = ?")
    .bind(id)
    .first<TemplateRow>();

  return Response.json(toDetailDTO(row!), { status: 201 });
};
