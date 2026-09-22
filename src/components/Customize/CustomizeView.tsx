import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Configuration, Parameter, Template } from "../../types/template";
import { defaultConfiguration } from "../../templates/defaultConfiguration";
import { useRenderMesh } from "../../state/useRenderMesh";
import { useServerPreview } from "../../state/useServerPreview";
import { useAccount } from "../../state/AccountContext";
import { estimateComplexity, complexityMessage } from "../../customizer/estimateComplexity";
import { submitExport, visibleConfiguration } from "../../api/exportClient";
import { saveDesign } from "../../api/accountClient";
import { Viewer } from "./Viewer";
import { ParameterPanel } from "./ParameterPanel";
import { ExportButton } from "./ExportButton";
import { ColorPicker } from "./ColorPicker";

const DEFAULT_COLOR = "#6366f1";
const COLOR_STORAGE_KEY = "openscad-web-management.viewerColor";

function loadStoredColor(): string {
  try {
    return localStorage.getItem(COLOR_STORAGE_KEY) ?? DEFAULT_COLOR;
  } catch {
    return DEFAULT_COLOR;
  }
}

interface CustomizeViewProps {
  template: Template;
  onBack: () => void;
  /** Pre-populates Configuration from a Saved Design instead of the
   * Template's bare defaults (see CONTEXT.md: Saved Design) — set when
   * TemplatePage was reached via a `?designId=` link from My designs. */
  initialConfig?: Configuration;
}

export function CustomizeView({ template, onBack, initialConfig }: CustomizeViewProps) {
  const [config, setConfig] = useState<Configuration>(
    () => initialConfig ?? defaultConfiguration(template),
  );
  const [color, setColor] = useState<string>(loadStoredColor);
  const { account } = useAccount();
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const complexity = useMemo(() => estimateComplexity(template.source), [template.source]);
  const complexityHint = useMemo(() => complexityMessage(complexity), [complexity]);

  const {
    geometry: clientGeometry,
    loading,
    error,
    skipped,
    renderInBrowser,
  } = useRenderMesh(template, config, complexity.hasExpensiveLoop);
  const serverPreview = useServerPreview();

  // While skipped, the client pipeline never ran (see useRenderMesh) — trust
  // the on-demand server preview instead. Once the user opts into the
  // client path (renderInBrowser), skipped stays false from then on, so
  // this naturally switches over and ignores any earlier server preview.
  const geometry = skipped ? serverPreview.geometry : clientGeometry;
  const effectiveLoading = skipped ? serverPreview.working : loading;
  const effectiveError = skipped ? serverPreview.error : error;

  function handleChange(name: string, value: Parameter["defaultValue"]) {
    setConfig((prev) => ({ ...prev, [name]: value }));
    setSaveState("idle");
  }

  function handleColorChange(next: string) {
    setColor(next);
    try {
      localStorage.setItem(COLOR_STORAGE_KEY, next);
    } catch {
      // Private browsing / blocked storage — color still works for this session.
    }
  }

  function handleRenderOnServer() {
    serverPreview.run(() =>
      submitExport(template.id, visibleConfiguration(template.parameters, config)),
    );
  }

  async function handleSaveDesign() {
    setSaveState("saving");
    try {
      await saveDesign(template.id, config);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  return (
    <div className="customize-view">
      <header className="customize-header">
        <button className="back-button" onClick={onBack}>
          ← Gallery
        </button>
        <h1>{template.name}</h1>
        <div className="customize-header-actions">
          {account === null && (
            <Link className="admin-link" to="/login">
              Sign in to save this design
            </Link>
          )}
          {account && (
            <button className="admin-link" onClick={handleSaveDesign} disabled={saveState === "saving"}>
              {saveState === "saving"
                ? "Saving…"
                : saveState === "saved"
                  ? "Saved ✓"
                  : "Save design"}
            </button>
          )}
          <ExportButton
            templateId={template.id}
            parameters={template.parameters}
            configuration={config}
            fileName={template.name.replace(/\s+/g, "-").toLowerCase()}
          />
        </div>
      </header>
      {saveState === "error" && (
        <p className="account-error customize-save-error">Couldn't save this design.</p>
      )}
      <div className="customize-body">
        <Viewer
          geometry={geometry}
          loading={effectiveLoading}
          error={effectiveError}
          color={color}
          complexityMessage={complexityHint}
          loadingMessage={skipped ? serverPreview.message : undefined}
          emptyState={
            skipped && (
              <div className="complex-design-cta">
                <p>{complexityHint ?? "This design is complex and may be slow to preview."}</p>
                <button className="export-button" onClick={handleRenderOnServer}>
                  Render on server
                </button>
                <button className="admin-link" onClick={renderInBrowser}>
                  Render in browser anyway
                </button>
              </div>
            )
          }
        />
        <aside className="customize-sidebar">
          {template.description && <p className="template-description">{template.description}</p>}
          {complexityHint && !skipped && <p className="complexity-hint">{complexityHint}</p>}
          {skipped && geometry && (
            <p className="complexity-hint">
              Server preview shown — change a setting and click{" "}
              <button className="link-button" onClick={handleRenderOnServer}>
                Render on server
              </button>{" "}
              again to refresh it.
            </p>
          )}
          <ColorPicker color={color} onChange={handleColorChange} />
          <ParameterPanel
            parameters={template.parameters}
            config={config}
            onChange={handleChange}
          />
        </aside>
      </div>
    </div>
  );
}
