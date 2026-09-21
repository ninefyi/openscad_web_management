import type { Parameter } from "../types/template";

/** Optional JSON sidecar for a Built-in Template. See CONTEXT.md: Template Manifest. */
export interface TemplateManifest {
  name?: string;
  description?: string;
  thumbnail?: string;
  labels?: Record<string, string>;
  order?: string[];
  hide?: string[];
}

/**
 * A .scad file's own `/* [Hidden] * /` group is a floor: the manifest can hide
 * additional Parameters but can never un-hide one the source already hid.
 */
export function applyManifest(
  parameters: Parameter[],
  manifest: TemplateManifest | undefined,
): Parameter[] {
  if (!manifest) return parameters;

  let result = parameters.map((param) => {
    const label = manifest.labels?.[param.name] ?? param.label;
    const hidden = param.hidden || (manifest.hide?.includes(param.name) ?? false);
    return { ...param, label, hidden };
  });

  if (manifest.order) {
    const order = manifest.order;
    result = [...result].sort((a, b) => {
      const ai = order.indexOf(a.name);
      const bi = order.indexOf(b.name);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }

  return result;
}
