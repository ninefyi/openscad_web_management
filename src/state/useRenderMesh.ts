import { useEffect, useRef, useState } from "react";
import type { BufferGeometry } from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import type { Configuration, Parameter, Template } from "../types/template";
import { serializeValue } from "../worker/serializeValue";
import type { RenderRequest, RenderResponse } from "../worker/render.worker";

const DEBOUNCE_MS = 400;

// openscad-wasm runs callMain() synchronously inside the Worker thread, so a
// pathological model (many boolean ops/text() at a high $fn) doesn't error
// out or time out on its own — it just occupies the Worker forever, and
// since the Worker's message loop is blocked, it can't even respond to a
// later render request once the user changes a parameter. Terminating the
// Worker from the main thread is the only way to interrupt it, so a render
// that's still running after this long is treated as unrecoverable and
// killed rather than left to run indefinitely.
const RENDER_TIMEOUT_MS = 60_000;

export interface RenderState {
  geometry: BufferGeometry | null;
  loading: boolean;
  error: string | null;
}

function buildDefines(parameters: Parameter[], config: Configuration): string[] {
  return parameters
    .filter((p) => !p.hidden)
    .map((p) => `${p.name}=${serializeValue(p, config[p.name] ?? p.defaultValue)}`);
}

/**
 * Renders a Template + Configuration into a Mesh via the render Worker,
 * debounced, keeping the last valid geometry on screen through a failed
 * Render (see ADR-0001 / CONTEXT.md: Render).
 */
export function useRenderMesh(template: Template, config: Configuration): RenderState {
  const [state, setState] = useState<RenderState>({
    geometry: null,
    loading: true,
    error: null,
  });

  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const pendingRef = useRef(false);
  const loaderRef = useRef(new STLLoader());
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearPendingTimeout() {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }

  function attachWorker(worker: Worker) {
    worker.onmessage = (event: MessageEvent<RenderResponse>) => {
      const msg = event.data;
      if (msg.requestId !== requestIdRef.current) return; // stale response

      pendingRef.current = false;
      clearPendingTimeout();

      if (msg.ok) {
        const geometry = loaderRef.current.parse(msg.stl);
        setState({ geometry, loading: false, error: null });
      } else {
        setState((prev) => ({ ...prev, loading: false, error: msg.error }));
      }
    };
  }

  function spawnWorker(): Worker {
    const worker = new Worker(new URL("../worker/render.worker.ts", import.meta.url), {
      type: "module",
    });
    attachWorker(worker);
    workerRef.current = worker;
    return worker;
  }

  useEffect(() => {
    spawnWorker();
    return () => {
      clearPendingTimeout();
      workerRef.current?.terminate();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    setState((prev) => ({ ...prev, loading: true }));

    const debounceTimer = setTimeout(() => {
      // A still-running previous render blocks the Worker's message loop
      // (openscad-wasm's callMain() is synchronous), so there's no way to
      // hand it this new request — start fresh rather than queue behind it.
      let worker = workerRef.current;
      if (pendingRef.current && worker) {
        clearPendingTimeout();
        worker.terminate();
        worker = spawnWorker();
      }
      if (!worker) return;

      pendingRef.current = true;
      const request: RenderRequest = {
        type: "render",
        requestId,
        source: template.source,
        defines: buildDefines(template.parameters, config),
      };
      worker.postMessage(request);

      const staleWorker = worker;
      timeoutRef.current = setTimeout(() => {
        pendingRef.current = false;
        staleWorker.terminate();
        spawnWorker();
        setState((prev) => ({
          ...prev,
          loading: false,
          error:
            "This design is too complex to preview in the browser and was stopped after 60 seconds. Try simplifying it, or export it anyway — exporting renders on the server instead.",
        }));
      }, RENDER_TIMEOUT_MS);
    }, DEBOUNCE_MS);

    return () => clearTimeout(debounceTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, config]);

  return state;
}
