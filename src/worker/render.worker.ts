/// <reference lib="webworker" />

interface OpenSCADInstance {
  FS: {
    writeFile: (path: string, data: string) => void;
    readFile: (path: string) => Uint8Array;
  };
  callMain: (args: string[]) => number;
}

type OpenSCADFactory = (options: {
  noInitialRun?: boolean;
  print?: (text: string) => void;
  printErr?: (text: string) => void;
}) => Promise<OpenSCADInstance>;

export interface RenderRequest {
  type: "render";
  requestId: number;
  source: string;
  defines: string[];
}

export type RenderResponse =
  | { type: "result"; requestId: number; ok: true; stl: ArrayBuffer }
  | { type: "result"; requestId: number; ok: false; error: string };

// openscad-wasm is built as a one-shot CLI, not a reusable library: its
// callMain() leaves internal (C++-side) global state that isn't safe to
// call a second time on the same instance — a second call on a cached
// instance crashes with a raw wasm exception pointer instead of a message.
// So every render gets its own fresh instance. The openscad.js wrapper
// still caches the fetched glue-script text, and the browser's HTTP cache
// covers the .wasm binary itself, so this is slower than reuse would be
// but not a full re-download each time.
async function createInstance(log: string[]): Promise<OpenSCADInstance> {
  const mod = await import(
    /* @vite-ignore */ new URL("/openscad/openscad.js", self.location.origin).href
  );
  const OpenSCAD = mod.default as OpenSCADFactory;
  const instance = await OpenSCAD({
    noInitialRun: true,
    print: (text) => log.push(text),
    printErr: (text) => log.push(text),
  });

  const fontsMod = await import(
    /* @vite-ignore */ new URL("/openscad/openscad.fonts.js", self.location.origin).href
  );
  (fontsMod.addFonts as (i: OpenSCADInstance) => void)(instance);

  return instance;
}

self.onmessage = async (event: MessageEvent<RenderRequest>) => {
  const { requestId, source, defines } = event.data;
  const log: string[] = [];

  try {
    const instance = await createInstance(log);
    instance.FS.writeFile("/input.scad", source);

    const args = [
      "/input.scad",
      ...defines.flatMap((d) => ["-D", d]),
      "-o",
      "/output.stl",
    ];
    instance.callMain(args);

    const output = instance.FS.readFile("/output.stl");
    const stl = output.buffer.slice(
      output.byteOffset,
      output.byteOffset + output.byteLength,
    ) as ArrayBuffer;

    const response: RenderResponse = { type: "result", requestId, ok: true, stl };
    self.postMessage(response, [stl]);
  } catch (err) {
    const message = log.length > 0 ? log.join("\n") : String(err);
    const response: RenderResponse = {
      type: "result",
      requestId,
      ok: false,
      error: message,
    };
    self.postMessage(response);
  }
};
