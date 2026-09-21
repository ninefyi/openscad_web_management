import type { Template } from "../types/template";
import { parseCustomizer } from "../customizer/parseCustomizer";
import { applyManifest, type TemplateManifest } from "./applyManifest";

import boxSource from "./builtin/box/box.scad?raw";
import boxManifest from "./builtin/box/template.json";
import keychainSource from "./builtin/keychain/keychain.scad?raw";
import keychainManifest from "./builtin/keychain/template.json";
import phoneStandSource from "./builtin/phone-stand/phone-stand.scad?raw";
import phoneStandManifest from "./builtin/phone-stand/template.json";

interface BuiltinEntry {
  id: string;
  source: string;
  manifest: TemplateManifest;
}

const entries: BuiltinEntry[] = [
  { id: "box", source: boxSource, manifest: boxManifest },
  { id: "keychain", source: keychainSource, manifest: keychainManifest },
  { id: "phone-stand", source: phoneStandSource, manifest: phoneStandManifest },
];

function buildTemplate(entry: BuiltinEntry): Template {
  const parsed = parseCustomizer(entry.source);
  return {
    id: entry.id,
    name: entry.manifest.name ?? entry.id,
    description: entry.manifest.description,
    thumbnail: entry.manifest.thumbnail,
    source: entry.source,
    parameters: applyManifest(parsed, entry.manifest),
  };
}

export const builtinTemplates: Template[] = entries.map(buildTemplate);
