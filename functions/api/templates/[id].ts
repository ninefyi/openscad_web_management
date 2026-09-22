import type { Env } from "../../lib/env";
import { toDetailDTO, type TemplateRow } from "../../lib/db";

export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const id = params.id as string;
  const row = await env.DB.prepare("SELECT * FROM templates WHERE id = ?")
    .bind(id)
    .first<TemplateRow>();

  // Same "not found" response either way — an unlisted Template's public
  // Customize URL is meant to be indistinguishable from one that never
  // existed, not a distinguishable "this exists but is unlisted" state.
  if (!row || row.is_listed !== 1) {
    return Response.json({ error: "Template not found" }, { status: 404 });
  }

  return Response.json(toDetailDTO(row));
};
