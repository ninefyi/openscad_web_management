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
const COLOR_STORAGE_KEY = "sukjab_scad.viewerColor";

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
}

export function CustomizeView({ template, onBack }: CustomizeViewProps) {
  const [config, setConfig] = useState<Configuration>(() =>
    defaultConfiguration(template),
  );
  const [color, setColor] = useState<string>(loadStoredColor);
  const { geometry, stl, loading, error } = useRenderMesh(template, config);
  const complexityHint = useMemo(
    () => complexityMessage(estimateComplexity(template.source)),
    [template.source],
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
        <ExportButton stl={stl} fileName={template.name.replace(/\s+/g, "-").toLowerCase()} />
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
