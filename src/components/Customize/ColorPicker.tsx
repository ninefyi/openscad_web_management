const PRESET_COLORS = [
  "#f5f5f5", // white
  "#1a1a1a", // black
  "#9ca3af", // gray
  "#ef4444", // red
  "#f97316", // orange
  "#facc15", // yellow
  "#22c55e", // green
  "#14b8a6", // teal
  "#3b82f6", // blue
  "#a855f7", // purple
  "#ec4899", // pink
];

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
}

export function ColorPicker({ color, onChange }: ColorPickerProps) {
  return (
    <div className="color-picker">
      <div className="color-picker-row">
        <span className="color-picker-label">Preview Color</span>
        <input
          type="color"
          value={color}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Custom preview color"
        />
      </div>
      <div className="color-swatches">
        {PRESET_COLORS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={`color-swatch${preset === color ? " color-swatch-selected" : ""}`}
            style={{ background: preset }}
            aria-label={preset}
            onClick={() => onChange(preset)}
          />
        ))}
      </div>
      <p className="color-picker-hint">Just for looking — doesn't change the exported file.</p>
    </div>
  );
}
