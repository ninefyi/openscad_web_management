import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { Configuration, Template } from "../types/template";
import { getBuiltinTemplate } from "../api/client";
import { getSavedDesign } from "../api/accountClient";
import { CustomizeView } from "../components/Customize/CustomizeView";

export function TemplatePage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const designId = searchParams.get("designId");
  const navigate = useNavigate();
  const [template, setTemplate] = useState<Template | null>(null);
  const [initialConfig, setInitialConfig] = useState<Configuration | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setTemplate(null);
    setError(null);
    Promise.all([
      getBuiltinTemplate(id),
      // A Saved Design's own Configuration, not the Template's bare
      // defaults (see CONTEXT.md: Saved Design) — only fetched when
      // reached via a My designs link.
      designId ? getSavedDesign(designId).then((d) => d.configuration) : Promise.resolve(undefined),
    ])
      .then(([t, config]) => {
        setTemplate(t);
        setInitialConfig(config);
      })
      .catch((err: Error) => setError(err.message));
  }, [id, designId]);

  if (error) {
    return (
      <div className="page-message">
        <p>{error}</p>
        <button onClick={() => navigate("/")}>Back to Gallery</button>
      </div>
    );
  }

  if (!template) {
    return <div className="page-message">Loading…</div>;
  }

  return (
    <CustomizeView
      template={template}
      onBack={() => navigate("/")}
      initialConfig={initialConfig}
    />
  );
}
