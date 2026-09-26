import type { Env } from "../../../../lib/env";
import { toTemplateImageDTO, type TemplateImageRow } from "../../../../lib/templateImages";

// Public counterpart to the admin images list — same "not found" behavior as
// the Template detail route: an unlisted Template's images are unreachable,
// not distinguishably "exists but unlisted" (see functions/api/templates/[id].ts).
export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const templateId = params.id as string;

  const template = await env.DB.prepare("SELECT is_listed FROM templates WHERE id = ?")
    .bind(templateId)
    .first<{ is_listed: number }>();
  if (!template || template.is_listed !== 1) {
    return Response.json({ error: "Template not found" }, { status: 404 });
  }

  const { results } = await env.DB.prepare(
    "SELECT * FROM template_images WHERE template_id = ? ORDER BY position ASC",
  )
    .bind(templateId)
    .all<TemplateImageRow>();
  return Response.json(results.map(toTemplateImageDTO));
};
