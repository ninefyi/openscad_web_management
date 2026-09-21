import { Link } from "react-router-dom";
import type { TemplateSummary } from "../../api/client";

interface TemplateCardProps {
  template: TemplateSummary;
}

export function TemplateCard({ template }: TemplateCardProps) {
  return (
    <Link className="template-card" to={`/t/${template.id}`}>
      <div className="template-card-thumb">
        {template.hasThumbnail ? (
          <img src={`/api/templates/${template.id}/thumbnail`} alt="" />
        ) : (
          <span className="template-card-thumb-placeholder">{template.name.charAt(0)}</span>
        )}
      </div>
      <div className="template-card-body">
        <h3>{template.name}</h3>
        {template.description && <p>{template.description}</p>}
      </div>
    </Link>
  );
}
