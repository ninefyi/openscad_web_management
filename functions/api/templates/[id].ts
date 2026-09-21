import type { Env } from "../../lib/env";
import { toDetailDTO, type TemplateRow } from "../../lib/db";

export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const id = params.id as string;
  const row = await env.DB.prepare("SELECT * FROM templates WHERE id = ?")
    .bind(id)
    .first<TemplateRow>();

  if (!row) {
    return Response.json({ error: "Template not found" }, { status: 404 });
  }

  return Response.json(toDetailDTO(row));
};
