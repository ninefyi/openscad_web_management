import { useNavigate, useLocation } from "react-router-dom";
import type { Template } from "../types/template";
import { CustomizeView } from "../components/Customize/CustomizeView";

export function UploadedTemplatePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const template = (location.state as { template?: Template } | null)?.template;

  if (!template) {
    return (
      <div className="page-message">
        <p>No uploaded file to show — uploads aren't saved, so refreshing loses it.</p>
        <button onClick={() => navigate("/")}>Back to Gallery</button>
      </div>
    );
  }

  return <CustomizeView template={template} onBack={() => navigate("/")} />;
}
