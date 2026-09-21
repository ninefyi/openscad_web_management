import type { Template } from "../types/template";
import { parseCustomizer } from "../customizer/parseCustomizer";

// Built-in Templates are D1-backed in v2 — see src/api/client.ts — not
// bundled here. The seed content under src/templates/builtin/ is what
// scripts/seed-d1.mjs loads into D1 for local dev / first deploy.

let uploadedCounter = 0;

export function templateFromUpload(fileName: string, source: string): Template {
  uploadedCounter += 1;
  return {
    id: `uploaded-${uploadedCounter}-${Date.now()}`,
    name: fileName.replace(/\.scad$/i, ""),
    source,
    parameters: parseCustomizer(source),
    kind: "uploaded",
  };
}
