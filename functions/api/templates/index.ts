import type { Env } from "../../lib/env";
import { toSummaryDTO, type TemplateRow } from "../../lib/db";
import { toTemplateImageDTO, type TemplateImageRow } from "../../lib/templateImages";

// Each Template's Template Images ride along so the Gallery can show them
// without one extra request per card.
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const [{ results: templates }, { results: images }] = await Promise.all([
    env.DB.prepare(
      "SELECT * FROM templates WHERE is_listed = 1 ORDER BY updated_at DESC",
    ).all<TemplateRow>(),
    env.DB.prepare(
      `SELECT template_images.* FROM template_images
       JOIN templates ON templates.id = template_images.template_id
       WHERE templates.is_listed = 1
       ORDER BY template_images.position ASC`,
    ).all<TemplateImageRow>(),
  ]);

  const imagesByTemplate = new Map<string, ReturnType<typeof toTemplateImageDTO>[]>();
  for (const row of images) {
    const list = imagesByTemplate.get(row.template_id) ?? [];
    list.push(toTemplateImageDTO(row));
    imagesByTemplate.set(row.template_id, list);
  }

  return Response.json(
    templates.map((row) => ({ ...toSummaryDTO(row), images: imagesByTemplate.get(row.id) ?? [] })),
  );
};
