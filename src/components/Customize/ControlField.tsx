import type { Parameter, ParameterValue } from "../../types/template";

interface ControlFieldProps {
  parameter: Parameter;
  value: ParameterValue;
  onChange: (value: ParameterValue) => void;
}

export function ControlField({ parameter, value, onChange }: ControlFieldProps) {
  switch (parameter.control) {
    case "slider":
      return (
        <div className="control control-slider">
          <div className="control-row">
            <label htmlFor={parameter.name}>{parameter.label}</label>
            <span className="control-value">{value as number}</span>
          </div>
          <input
            id={parameter.name}
            type="range"
            min={parameter.min}
            max={parameter.max}
            step={parameter.step}
            value={value as number}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        </div>
      );

    case "number":
      return (
        <div className="control control-number">
          <label htmlFor={parameter.name}>{parameter.label}</label>
          <input
            id={parameter.name}
            type="number"
            value={value as number}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        </div>
      );

    case "dropdown":
      return (
        <div className="control control-dropdown">
          <label htmlFor={parameter.name}>{parameter.label}</label>
          <select
            id={parameter.name}
            value={value as string}
            onChange={(e) => onChange(e.target.value)}
          >
            {parameter.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      );

    case "checkbox":
      return (
        <div className="control control-checkbox">
          <label htmlFor={parameter.name}>
            <input
              id={parameter.name}
              type="checkbox"
              checked={value as boolean}
              onChange={(e) => onChange(e.target.checked)}
            />
            {parameter.label}
          </label>
        </div>
      );

    case "color": {
      const vec = value as number[];
      const hex = rgbToHex(vec);
      return (
        <div className="control control-color">
          <label htmlFor={parameter.name}>{parameter.label}</label>
          <input
            id={parameter.name}
            type="color"
            value={hex}
            onChange={(e) => onChange(hexToRgb(e.target.value))}
          />
        </div>
      );
    }

    case "text":
      return (
        <div className="control control-text">
          <label htmlFor={parameter.name}>{parameter.label}</label>
          <input
            id={parameter.name}
            type="text"
            value={value as string}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );
  }
}

function rgbToHex(vec: number[]): string {
  const [r, g, b] = vec;
  const toByte = (n: number) =>
    Math.round(Math.min(1, Math.max(0, n)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toByte(r ?? 0)}${toByte(g ?? 0)}${toByte(b ?? 0)}`;
}

function hexToRgb(hex: string): number[] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  return [r, g, b];
}
