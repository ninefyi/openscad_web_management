import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Template } from "../types/template";
import { getBuiltinTemplate } from "../api/client";
import { CustomizeView } from "../components/Customize/CustomizeView";

export function TemplatePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [template, setTemplate] = useState<Template | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setTemplate(null);
    setError(null);
    getBuiltinTemplate(id)
      .then(setTemplate)
      .catch((err: Error) => setError(err.message));
  }, [id]);

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

  return <CustomizeView template={template} onBack={() => navigate("/")} />;
}
