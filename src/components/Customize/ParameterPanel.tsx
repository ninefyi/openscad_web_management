import type { Configuration, Parameter } from "../../types/template";
import { ControlField } from "./ControlField";

interface ParameterPanelProps {
  parameters: Parameter[];
  config: Configuration;
  onChange: (name: string, value: Parameter["defaultValue"]) => void;
}

export function ParameterPanel({ parameters, config, onChange }: ParameterPanelProps) {
  const visible = parameters.filter((p) => !p.hidden);
  const groups = new Map<string, Parameter[]>();
  for (const param of visible) {
    const key = param.group || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(param);
  }

  if (visible.length === 0) {
    return <p className="parameter-panel-empty">This template has no adjustable parameters.</p>;
  }

  return (
    <div className="parameter-panel">
      {[...groups.entries()].map(([group, params]) => (
        <fieldset key={group || "default"} className="parameter-group">
          {group && <legend>{group}</legend>}
          {params.map((param) => (
            <ControlField
              key={param.name}
              parameter={param}
              value={config[param.name] ?? param.defaultValue}
              onChange={(value) => onChange(param.name, value)}
            />
          ))}
        </fieldset>
      ))}
    </div>
  );
}
