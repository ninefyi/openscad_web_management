#!/usr/bin/env node
// Seeds D1 with the starter Built-in Templates from src/templates/builtin/.
// Usage: node scripts/seed-d1.mjs [--remote]
// (--remote seeds the real Cloudflare D1 database instead of the local one.)

import { readFileSync, readdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = dirname(fileURLToPath(import.meta.url));
const builtinDir = join(root, "..", "src", "templates", "builtin");
const remote = process.argv.includes("--remote");

function sqlString(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

const now = new Date().toISOString();
const statements = [];

for (const entry of readdirSync(builtinDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = join(builtinDir, entry.name);
  const scadFile = readdirSync(dir).find((f) => f.endsWith(".scad"));
  if (!scadFile) continue;

  const source = readFileSync(join(dir, scadFile), "utf8");
  const manifest = JSON.parse(readFileSync(join(dir, "template.json"), "utf8"));

  statements.push(
    `INSERT OR REPLACE INTO templates
      (id, name, description, source, manifest_labels, manifest_order, manifest_hide, thumbnail_key, created_at, updated_at)
     VALUES (${sqlString(entry.name)}, ${sqlString(manifest.name ?? entry.name)}, ${sqlString(manifest.description)}, ${sqlString(source)}, ${sqlString(JSON.stringify(manifest.labels ?? {}))}, ${sqlString(JSON.stringify(manifest.order ?? []))}, ${sqlString(JSON.stringify(manifest.hide ?? []))}, NULL, ${sqlString(now)}, ${sqlString(now)});`,
  );
}

const tmpFile = join(root, ".seed.sql");
writeFileSync(tmpFile, statements.join("\n"));

try {
  const args = [
    "wrangler",
    "d1",
    "execute",
    "sukjab-scad",
    remote ? "--remote" : "--local",
    "--file",
    tmpFile,
  ];
  console.log(`Seeding ${statements.length} template(s) into ${remote ? "remote" : "local"} D1...`);
  execFileSync("npx", args, { stdio: "inherit", cwd: join(root, "..") });
} finally {
  unlinkSync(tmpFile);
}
