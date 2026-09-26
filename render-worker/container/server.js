// Minimal HTTP wrapper around the native `openscad` CLI, run inside the
// Cloudflare Container. Deliberately dependency-free (Node built-ins only)
// since this only needs to do one thing: take .scad source + -D overrides
// (+ an optional export format, stl or 3mf — see CONTEXT.md: Export Job),
// shell out to openscad, and return the resulting file bytes or an error.
import http from "node:http";
import { spawn } from "node:child_process";
import { writeFile, readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = process.env.PORT || 8080;
const RENDER_TIMEOUT_MS = 4 * 60 * 1000;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function runOpenscad(args) {
  return new Promise((resolve) => {
    const child = spawn("openscad", args, { timeout: RENDER_TIMEOUT_MS });
    let output = "";
    child.stdout.on("data", (d) => (output += d.toString()));
    child.stderr.on("data", (d) => (output += d.toString()));
    child.on("close", (code) => resolve({ code, output }));
    child.on("error", (err) => resolve({ code: 1, output: String(err) }));
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200);
    res.end("ok");
    return;
  }

  if (req.method !== "POST" || req.url !== "/render") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  let payload;
  try {
    payload = JSON.parse((await readBody(req)).toString("utf8"));
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON body" }));
    return;
  }

  const { source, defines, format } = payload;
  if (typeof source !== "string") {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "source is required" }));
    return;
  }
  const ext = format === "3mf" ? "3mf" : "stl";
  const contentType = ext === "3mf" ? "model/3mf" : "model/stl";

  const dir = await mkdtemp(join(tmpdir(), "scad-"));
  const inputPath = join(dir, "input.scad");
  // OpenSCAD infers the export format from this extension — no separate
  // --export-format flag needed.
  const outputPath = join(dir, `output.${ext}`);

  try {
    await writeFile(inputPath, source, "utf8");

    // --backend=manifold: CGAL is still openscad-nightly's default even
    // post-graduation, so this has to be passed explicitly every render —
    // the older --enable=manifold spelling silently no-ops back to CGAL
    // instead of erroring, so a stale flag here would fail silently too.
    const args = [
      inputPath,
      "--backend=manifold",
      ...(defines ?? []).flatMap((d) => ["-D", d]),
      "-o",
      outputPath,
    ];
    if (ext === "stl") {
      // ASCII is OpenSCAD's own default STL encoding — several times
      // larger than binary for the same geometry, and much slower for a
      // browser's STLLoader to parse. Binary is a fixed-size read;
      // STLLoader already auto-detects and handles both.
      args.push("--export-format=binstl");
    }
    const { code, output } = await runOpenscad(args);

    if (code !== 0) {
      res.writeHead(422, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: output || `openscad exited with code ${code}` }));
      return;
    }

    const bytes = await readFile(outputPath);
    res.writeHead(200, { "content-type": contentType });
    res.end(bytes);
  } catch (err) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

server.listen(PORT, () => console.log(`render server listening on ${PORT}`));
