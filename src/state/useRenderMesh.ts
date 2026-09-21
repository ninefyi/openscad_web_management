import { useEffect, useRef, useState } from "react";
import type { BufferGeometry } from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import type { Configuration, Parameter, Template } from "../types/template";
import { serializeValue } from "../worker/serializeValue";
import type { RenderRequest, RenderResponse } from "../worker/render.worker";

const DEBOUNCE_MS = 400;

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
  const loaderRef = useRef(new STLLoader());

  useEffect(() => {
    const worker = new Worker(new URL("../worker/render.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<RenderResponse>) => {
      const msg = event.data;
      if (msg.requestId !== requestIdRef.current) return; // stale response

      if (msg.ok) {
        const geometry = loaderRef.current.parse(msg.stl);
        setState({ geometry, loading: false, error: null });
      } else {
        setState((prev) => ({ ...prev, loading: false, error: msg.error }));
      }
    };

    return () => worker.terminate();
  }, []);

  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;

    const requestId = ++requestIdRef.current;
    setState((prev) => ({ ...prev, loading: true }));

    const timer = setTimeout(() => {
      const request: RenderRequest = {
        type: "render",
        requestId,
        source: template.source,
        defines: buildDefines(template.parameters, config),
      };
      worker.postMessage(request);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, config]);

  return state;
}
