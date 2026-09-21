import { builtinTemplates } from "../../templates/registry";
import type { Template } from "../../types/template";
import { TemplateCard } from "./TemplateCard";

interface GalleryProps {
  onSelect: (template: Template) => void;
}

export function Gallery({ onSelect }: GalleryProps) {
  return (
    <div className="gallery">
      <header className="gallery-header">
        <h1>sukjab_scad</h1>
        <p>Pick a design, adjust it to fit, export it ready to print.</p>
      </header>
      <div className="gallery-grid">
        {builtinTemplates.map((template) => (
          <TemplateCard key={template.id} template={template} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}
