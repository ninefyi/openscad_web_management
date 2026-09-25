import { useMemo, useState } from "react";
import type { Configuration, Parameter, Template } from "../../types/template";
import { defaultConfiguration } from "../../templates/defaultConfiguration";
import { useRenderMesh } from "../../state/useRenderMesh";
import { estimateComplexity, complexityMessage } from "../../customizer/estimateComplexity";
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

  const complexity = useMemo(() => estimateComplexity(template.source), [template.source]);
  const complexityHint = useMemo(() => complexityMessage(complexity), [complexity]);

  // Render on server isn't offered here — only the Admin Panel gets that
  // choice (see CONTEXT.md: Render on server). A customer flagged skipped
  // gets exactly one option: an explicit, opt-in client-side Render,
  // guarded by useRenderMesh's own 60s timeout.
  const { geometry, loading, error, skipped, renderInBrowser } = useRenderMesh(
    template,
    config,
    complexity.hasExpensiveLoop,
  );

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
          emptyState={
            skipped && (
              <div className="complex-design-cta">
                <p>{complexityHint ?? "This design is complex and may be slow to preview."}</p>
                <button className="export-button" onClick={renderInBrowser}>
                  Render
                </button>
              </div>
            )
          }
        />
        <aside className="customize-sidebar">
          {template.description && <p className="template-description">{template.description}</p>}
          {complexityHint && !skipped && <p className="complexity-hint">{complexityHint}</p>}
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
