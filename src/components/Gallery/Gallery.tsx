import { useEffect, useState } from "react";
import { listBuiltinTemplates, type TemplateSummary } from "../../api/client";
import { TemplateCard } from "./TemplateCard";

export function Gallery() {
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listBuiltinTemplates()
      .then(setTemplates)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <div className="gallery">
      <header className="gallery-header">
        <h1>OpenSCAD Web Management</h1>
        <p>Pick a design, adjust it to fit, export it ready to print.</p>
      </header>
      {error && <p className="gallery-error">{error}</p>}
      {!error && !templates && <p className="gallery-loading">Loading templates…</p>}
      {templates && (
        <div className="gallery-grid">
          {templates.map((template) => (
            <TemplateCard key={template.id} template={template} />
          ))}
        </div>
      )}
    </div>
  );
}
