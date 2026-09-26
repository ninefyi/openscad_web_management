import { useMemo, useState } from "react";
import type { Configuration, Parameter, Template } from "../../types/template";
import { defaultConfiguration } from "../../templates/defaultConfiguration";
import { useRenderMesh } from "../../state/useRenderMesh";
import { estimateComplexity, complexityMessage } from "../../customizer/estimateComplexity";
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

  // Always auto-renders, even for a Template flagged complex — see
  // ADR-0012 for why the earlier skip-then-click gate (ADR-0007) is gone
  // for customers specifically; useRenderMesh's own 60s timeout is still
  // the safety net if a render genuinely can't finish. `true` here opts
  // into the default-preview cache race (ADR-0010) — the Admin Panel's
  // own preview never does (see ADR-0009: an Admin always wants a current
  // result), and keeps its own explicit skip-then-click gate as-is.
  const { geometry, loading, error } = useRenderMesh(template, config, false, true);

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
        />
        <aside className="customize-sidebar">
          {template.description && <p className="template-description">{template.description}</p>}
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
