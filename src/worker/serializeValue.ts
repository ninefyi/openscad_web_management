import type { Parameter, ParameterValue } from "../types/template";

/** Formats a Configuration value as an OpenSCAD literal, for use with `-D name=<literal>`. */
export function serializeValue(param: Parameter, value: ParameterValue): string {
  if (param.control === "checkbox") return value ? "true" : "false";
  if (param.control === "color") {
    const vec = value as number[];
    return `[${vec.join(",")}]`;
  }
  if (typeof value === "string") {
    if (param.control === "text" && value.trim().startsWith("[")) {
      // Raw vector text re-entered verbatim (unsupported-vector fallback case).
      return value.trim();
    }
    return JSON.stringify(value);
  }
  return String(value);
}
