import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { Configuration, Parameter, Template } from "../../types/template";
import { defaultConfiguration } from "../../templates/defaultConfiguration";
import { useRenderMesh } from "../../state/useRenderMesh";
import { estimateComplexity, complexityMessage } from "../../customizer/estimateComplexity";
import { useAccount } from "../../state/AccountContext";
import {
  clearStashedConfiguration,
  readStashedConfiguration,
  signInPath,
  stashConfiguration,
} from "../../account/signInReturn";
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
  const location = useLocation();
  const [config, setConfig] = useState<Configuration>(
    () => readStashedConfiguration(template.id) ?? initialConfig ?? defaultConfiguration(template),
  );
  useEffect(() => clearStashedConfiguration(template.id), [template.id]);
  const [color, setColor] = useState<string>(loadStoredColor);

  const complexity = useMemo(() => estimateComplexity(template.source), [template.source]);
  const complexityHint = useMemo(() => complexityMessage(complexity), [complexity]);

  // Auto-renders once on first paint (usually from the default-preview
  // cache — ADR-0010); after that a Configuration change only marks the
  // Mesh stale until the customer clicks Render (ADR-0013).
  const { geometry, loading, error, render, hasPendingChanges } = useRenderMesh(
    template,
    config,
    false,
    true,
  );
  // Render and Export both require a signed-in Account. A signed-out
  // visitor still sees the default Configuration instantly and can edit
  // Parameters, but the only action offered is Sign in, which returns here
  // with those edits intact.
  const { account } = useAccount();

  function handleSignIn() {
    stashConfiguration(template.id, config);
  }

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
            <Link
              className="export-button"
              to={signInPath(location.pathname + location.search)}
              onClick={handleSignIn}
            >
              Sign in
            </Link>
          ) : (
            <>
              <button
                className="render-button"
                onClick={render}
                disabled={!hasPendingChanges || loading || account === undefined}
              >
                Render
              </button>
              <ExportButton
                templateId={template.id}
                parameters={template.parameters}
                configuration={config}
                fileName={template.name.replace(/\s+/g, "-").toLowerCase()}
              />
            </>
          )}
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
