import type { Template } from "../../types/template";

interface TemplateCardProps {
  template: Template;
  onSelect: (template: Template) => void;
}

export function TemplateCard({ template, onSelect }: TemplateCardProps) {
  return (
    <button className="template-card" onClick={() => onSelect(template)}>
      <div className="template-card-thumb">
        {template.thumbnail ? (
          <img src={template.thumbnail} alt="" />
        ) : (
          <span className="template-card-thumb-placeholder">{template.name.charAt(0)}</span>
        )}
      </div>
      <div className="template-card-body">
        <h3>{template.name}</h3>
        {template.description && <p>{template.description}</p>}
      </div>
    </button>
  );
}
