export const MAX_TEMPLATE_IMAGES = 3;

export interface TemplateImageRow {
  id: string;
  template_id: string;
  r2_key: string;
  content_type: string;
  position: number;
  created_at: string;
}

export interface TemplateImageDTO {
  id: string;
  url: string;
  position: number;
}

export function toTemplateImageDTO(row: TemplateImageRow): TemplateImageDTO {
  return {
    id: row.id,
    url: `/api/templates/${row.template_id}/images/${row.id}`,
    position: row.position,
  };
}
