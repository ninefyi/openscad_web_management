import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Configuration, Parameter, Template } from "../../types/template";
import { defaultConfiguration } from "../../templates/defaultConfiguration";
import { useRenderMesh } from "../../state/useRenderMesh";
import { estimateComplexity, complexityMessage } from "../../customizer/estimateComplexity";
import { useAccount } from "../../state/AccountContext";
import { Viewer } from "./Viewer";
import { ParameterPanel } from "./ParameterPanel";
import { ExportButton } from "./ExportButton";
import { ColorPicker } from "./ColorPicker";
import { ImageGallery } from "./ImageGallery";

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

  const complexity = useMemo(() => estimateComplexity(template.source), [template.source]);
  const complexityHint = useMemo(() => complexityMessage(complexity), [complexity]);

  // Auto-renders once per Template (still benefiting from the
  // default-preview cache race on that first paint — ADR-0010), but a
  // Configuration change after that only marks the Mesh stale; the
  // customer clicks Render to actually re-render (ADR-0013, following
  // ADR-0012's removal of the old skip-then-click gate, ADR-0007, for a
  // different reason — this isn't about protecting against a hang,
  // useRenderMesh's 60s timeout still does that, it's about not firing a
  // render on every slider tick at all). The Admin Panel's own preview
  // does neither — see ADR-0009: an Admin always wants a current result.
  const { geometry, loading, error, render, hasPendingChanges } = useRenderMesh(
    template,
    config,
    false,
    true,
    true,
  );
  // Render (the manual re-render click, not the automatic first paint —
  // see ADR-0013) requires a signed-in Account, same gate as Export: an
  // anonymous visitor still sees the Template's default Configuration
  // instantly, just can't preview their own edits without signing in.
  const { account } = useAccount();

  function handleChange(name: string, value: Parameter["defaultValue"]) {
    setConfig((prev) => ({ ...prev, [name]: value }));
  }

  function handleColorChange(next: string) {
    setColor(next);
    try {
      localStorage.setItem(COLOR_STORAGE_KEY, next);
    } catch {
      // Private browsing / blocked storage — color still works for this session.
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
          {account === null ? (
            <Link className="admin-link" to="/login">
              Sign in to render
            </Link>
          ) : (
            <button
              className="render-button"
              onClick={render}
              disabled={!hasPendingChanges || loading || account === undefined}
            >
              Render
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
      <div className="customize-body">
        <Viewer
          geometry={geometry}
          loading={loading}
          error={error}
          color={color}
          complexityMessage={complexityHint}
        />
        <aside className="customize-sidebar">
          {template.description && <p className="template-description">{template.description}</p>}
          {hasPendingChanges && !loading && (
            <p className="pending-changes-hint">
              {account === null
                ? "Parameters have changed — sign in to preview the update."
                : "Parameters have changed — click Render to update."}
            </p>
          )}
          {complexityHint && <p className="complexity-hint">{complexityHint}</p>}
          <ImageGallery templateId={template.id} />
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
