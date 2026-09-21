import type { Parameter, ParameterValue } from "../types/template";

const GROUP_HEADER_RE = /^\s*\/\*\s*\[(.+?)\]\s*\*\/\s*$/;
const ASSIGNMENT_RE =
  /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?);\s*(\/\/\s*(.*))?\s*$/;
const RANGE_RE = /^\[\s*(-?[\d.]+)?\s*:\s*(-?[\d.]+)?\s*(?::\s*(-?[\d.]+)?)?\s*\]$/;
const OPTIONS_RE = /^\[(.+)\]$/;

function toLabel(name: string): string {
  const spaced = name
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function parseLiteral(raw: string): ParameterValue | undefined {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1);
    const parts = inner.split(",").map((p) => Number(p.trim()));
    if (parts.every((n) => !Number.isNaN(n))) return parts;
    return undefined;
  }
  const n = Number(trimmed);
  if (!Number.isNaN(n)) return n;
  return undefined;
}

/**
 * Parses the OpenSCAD Customizer comment convention out of raw .scad source:
 * `/* [Group] * /` section headers (a `/* [Hidden] * /` section hides everything
 * under it), `// [min:max]` / `// [min:step:max]` range annotations, and
 * `// [a,b,c]` / `// [a:Label,b:Label]` dropdown option lists. Only top-level
 * (brace depth 0) assignments are treated as Parameters.
 */
export function parseCustomizer(source: string): Parameter[] {
  const lines = source.split("\n");
  const parameters: Parameter[] = [];

  let currentGroup = "";
  let currentHidden = false;
  let pendingDescription: string | undefined;
  let braceDepth = 0;

  for (const line of lines) {
    const groupMatch = line.match(GROUP_HEADER_RE);
    if (groupMatch) {
      const name = groupMatch[1].trim();
      currentHidden = name.toLowerCase() === "hidden";
      currentGroup = currentHidden ? "" : name;
      pendingDescription = undefined;
      continue;
    }

    if (braceDepth === 0) {
      const assignMatch = line.match(ASSIGNMENT_RE);
      if (assignMatch) {
        const [, name, rawValue, , annotation] = assignMatch;
        const literal = parseLiteral(rawValue);
        if (literal !== undefined) {
          const parameter = buildParameter({
            name,
            literal,
            annotation: annotation?.trim(),
            group: currentGroup,
            hidden: currentHidden,
            description: pendingDescription,
          });
          if (parameter) parameters.push(parameter);
          pendingDescription = undefined;
          braceDepth += countBraces(line);
          continue;
        }
      }
    }

    const commentOnlyMatch = line.match(/^\s*\/\/\s*(.*\S)\s*$/);
    if (commentOnlyMatch && braceDepth === 0) {
      pendingDescription = commentOnlyMatch[1];
    } else {
      // A description comment must sit directly above its variable, per the
      // Customizer convention — a blank line (or anything else) breaks that
      // adjacency, so any unrelated comment above it must not carry forward.
      pendingDescription = undefined;
    }

    braceDepth += countBraces(line);
    if (braceDepth < 0) braceDepth = 0;
  }

  return parameters;
}

function countBraces(line: string): number {
  const opens = (line.match(/{/g) ?? []).length;
  const closes = (line.match(/}/g) ?? []).length;
  return opens - closes;
}

function buildParameter(args: {
  name: string;
  literal: ParameterValue;
  annotation: string | undefined;
  group: string;
  hidden: boolean;
  description: string | undefined;
}): Parameter | null {
  const { name, literal, annotation, group, hidden, description } = args;
  const label = description ?? toLabel(name);
  const base = { name, label, group, hidden };

  if (typeof literal === "boolean") {
    return {
      ...base,
      control: "checkbox",
      annotated: false,
      defaultValue: literal,
    };
  }

  if (typeof literal === "string") {
    const optionsMatch = annotation?.match(OPTIONS_RE);
    if (optionsMatch && !RANGE_RE.test(annotation ?? "")) {
      const options = optionsMatch[1].split(",").map((entry) => {
        const [value, optLabel] = entry.split(":").map((s) => s.trim());
        return { value, label: optLabel ?? value };
      });
      return {
        ...base,
        control: "dropdown",
        annotated: true,
        options,
        defaultValue: literal,
      };
    }
    return { ...base, control: "text", annotated: false, defaultValue: literal };
  }

  if (Array.isArray(literal)) {
    if (annotation?.toLowerCase() === "color" && literal.length >= 3) {
      return {
        ...base,
        control: "color",
        annotated: true,
        defaultValue: literal,
      };
    }
    // Unsupported vector shape: expose as raw editable text.
    return {
      ...base,
      control: "text",
      annotated: false,
      defaultValue: `[${literal.join(", ")}]`,
    };
  }

  // number
  const rangeMatch = annotation?.match(RANGE_RE);
  if (rangeMatch) {
    const [, a, b, c] = rangeMatch;
    let min: number;
    let max: number;
    let step: number;
    if (c !== undefined) {
      min = Number(a);
      step = Number(b);
      max = Number(c);
    } else {
      min = a !== undefined ? Number(a) : 0;
      max = b !== undefined ? Number(b) : literal;
      step = Number.isInteger(literal) ? 1 : 0.1;
    }
    return {
      ...base,
      control: "slider",
      annotated: true,
      min,
      max,
      step,
      defaultValue: literal,
    };
  }

  const optionsMatch = annotation?.match(OPTIONS_RE);
  if (optionsMatch) {
    const options = optionsMatch[1].split(",").map((entry) => {
      const [value, optLabel] = entry.split(":").map((s) => s.trim());
      return { value, label: optLabel ?? value };
    });
    return {
      ...base,
      control: "dropdown",
      annotated: true,
      options,
      defaultValue: String(literal),
    };
  }

  return { ...base, control: "number", annotated: false, defaultValue: literal };
}
