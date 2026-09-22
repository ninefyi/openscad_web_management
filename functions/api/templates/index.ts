import type { Env } from "../../lib/env";
import { toSummaryDTO, type TemplateRow } from "../../lib/db";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const { results } = await env.DB.prepare(
    "SELECT * FROM templates WHERE is_listed = 1 ORDER BY updated_at DESC",
  ).all<TemplateRow>();
  const summaries = results.map(toSummaryDTO);
  return Response.json(summaries);
};
