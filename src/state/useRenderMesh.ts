import { useEffect, useRef, useState } from "react";
import type { BufferGeometry } from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import type { Configuration, Parameter, Template } from "../types/template";
import { serializeValue } from "../worker/serializeValue";
import type { RenderRequest, RenderResponse } from "../worker/render.worker";

const MAX_CACHE_ENTRIES = 10;

// openscad-wasm runs callMain() synchronously inside the Worker thread, so a
// pathological model (many boolean ops/text() at a high $fn) doesn't error
// out or time out on its own — it just occupies the Worker forever, and
// since the Worker's message loop is blocked, it can't even respond to a
// later render request. Terminating the Worker from the main thread is the
// only way to interrupt it, so a render that's still running after this
// long is treated as unrecoverable and killed rather than left to run
// indefinitely.
const RENDER_TIMEOUT_MS = 60_000;

export interface RenderState {
  geometry: BufferGeometry | null;
  loading: boolean;
  error: string | null;
  /** True when the first paint was held back by skipAutoRender and nothing
   * has been rendered since — "we didn't try," not "we're trying." */
  skipped: boolean;
}

function buildDefines(parameters: Parameter[], config: Configuration): string[] {
  return parameters
    .filter((p) => !p.hidden)
    .map((p) => `${p.name}=${serializeValue(p, config[p.name] ?? p.defaultValue)}`);
}

function cacheKey(source: string, defines: string[]): string {
  return source + "\0" + defines.join("\0");
}

interface RenderRequestSnapshot {
  source: string;
  defines: string[];
  key: string;
  /** The automatic first paint, as opposed to an explicit render() click. */
  isFirst: boolean;
  isDefaultConfig: boolean;
  skip: boolean;
  tick: number;
}

/**
 * Renders a Template + Configuration into a Mesh via the render Worker,
 * keeping the last valid geometry on screen through a failed Render (see
 * ADR-0001 / CONTEXT.md: Render).
 *
 * Only two things ever start a Render: the automatic first paint when the
 * hook mounts, and an explicit `render()` call (ADR-0013, ADR-0015).
 * Changing `template.source` or `config` afterwards never renders — it only
 * makes `hasPendingChanges` true. This is enforced structurally: the render
 * effect depends on a snapshot of the inputs taken at mount or at
 * `render()`, never on the live inputs themselves.
 *
 * `skipAutoRender` holds back live compute on the first paint for a design
 * estimateComplexity flags as likely to hang the tab (ADR-0007); `render()`
 * is the explicit opt-in. `useDefaultPreviewCache` races a fetch of the
 * Template's precomputed default-Configuration preview (ADR-0010) on that
 * first paint only. The cache reflects the last Save, and the first paint
 * is the only point guaranteed to be showing exactly that.
 *
 * Identical (source, defines) pairs are served from an in-memory cache, so
 * clicking Render again with nothing changed re-shows the result instead of
 * recomputing it.
 */
export function useRenderMesh(
  template: Template,
  config: Configuration,
  skipAutoRender = false,
  useDefaultPreviewCache = false,
): RenderState & {
  render: () => void;
  hasPendingChanges: boolean;
  /** Whether `geometry` was rendered from exactly the current source and
   * Configuration — false while stale, or before anything has rendered. */
  isCurrent: boolean;
} {
  const defines = buildDefines(template.parameters, config);
  const key = cacheKey(template.source, defines);

  const [request, setRequest] = useState<RenderRequestSnapshot>(() => ({
    source: template.source,
    defines,
    key,
    isFirst: true,
    isDefaultConfig: key === cacheKey(template.source, buildDefines(template.parameters, {})),
    skip: skipAutoRender,
    tick: 0,
  }));
  const [state, setState] = useState<RenderState & { renderedKey: string | null }>({
    geometry: null,
    loading: !skipAutoRender,
    error: null,
    skipped: skipAutoRender,
    renderedKey: null,
  });

  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const pendingRef = useRef(false);
  const pendingKeyRef = useRef<string | null>(null);
  const loaderRef = useRef(new STLLoader());
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cacheRef = useRef<Map<string, BufferGeometry>>(new Map());

  function clearPendingTimeout() {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }

  function rememberGeometry(cacheEntryKey: string, geometry: BufferGeometry) {
    const cache = cacheRef.current;
    cache.delete(cacheEntryKey);
    cache.set(cacheEntryKey, geometry);
    if (cache.size > MAX_CACHE_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) {
        cache.get(oldestKey)?.dispose();
        cache.delete(oldestKey);
      }
    }
  }

  function attachWorker(worker: Worker) {
    worker.onmessage = (event: MessageEvent<RenderResponse>) => {
      const msg = event.data;
      if (msg.requestId !== requestIdRef.current) return; // stale response

      pendingRef.current = false;
      clearPendingTimeout();
      const renderedKey = pendingKeyRef.current;
      pendingKeyRef.current = null;

      if (msg.ok) {
        const geometry = loaderRef.current.parse(msg.stl);
        if (renderedKey) rememberGeometry(renderedKey, geometry);
        setState({ geometry, loading: false, error: null, skipped: false, renderedKey });
      } else {
        setState((prev) => ({ ...prev, loading: false, error: msg.error, skipped: false }));
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
    const cache = cacheRef.current;
    return () => {
      clearPendingTimeout();
      workerRef.current?.terminate();
      for (const geometry of cache.values()) geometry.dispose();
      cache.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function render() {
    setRequest((prev) => ({
      source: template.source,
      defines,
      key,
      isFirst: false,
      isDefaultConfig: false,
      skip: false,
      tick: prev.tick + 1,
    }));
  }

  useEffect(() => {
    const controller = new AbortController();
    const tryCache = request.isFirst && request.isDefaultConfig && useDefaultPreviewCache;

    // A hit wins outright — cheap enough to override the skip gate too,
    // since fetching isn't the compute that gate protects against. A miss
    // is a silent no-op, leaving whatever's already scheduled untouched.
    function tryDefaultPreviewCache(requestId: number) {
      fetch(`/api/templates/${template.id}/default-preview`, { signal: controller.signal })
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error("miss"))))
        .then((buf) => {
          if (requestId !== requestIdRef.current) return; // superseded or already won
          const geometry = loaderRef.current.parse(buf);
          rememberGeometry(request.key, geometry);
          requestIdRef.current++; // invalidate whatever else is still in flight
          setState({ geometry, loading: false, error: null, skipped: false, renderedKey: request.key });
        })
        .catch(() => {});
    }

    if (request.skip) {
      const requestId = ++requestIdRef.current;
      if (tryCache) tryDefaultPreviewCache(requestId);
      return () => controller.abort();
    }

    const cached = cacheRef.current.get(request.key);
    if (cached) {
      cacheRef.current.delete(request.key);
      cacheRef.current.set(request.key, cached); // bump to most-recently-used
      requestIdRef.current++; // invalidate any response still in flight
      setState({ geometry: cached, loading: false, error: null, skipped: false, renderedKey: request.key });
      return () => controller.abort();
    }

    // This exact Render is already running — let it finish instead of
    // killing identical work.
    if (pendingRef.current && pendingKeyRef.current === request.key) {
      return () => controller.abort();
    }

    const requestId = ++requestIdRef.current;
    setState((prev) => ({ ...prev, loading: true, skipped: false }));
    if (tryCache) tryDefaultPreviewCache(requestId);

    // Deferred a tick so a cancelled effect run (StrictMode's double
    // invocation) never reaches the Worker.
    const startTimer = setTimeout(() => {
      if (requestId !== requestIdRef.current) return; // a cache hit already won

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
      pendingKeyRef.current = request.key;
      const message: RenderRequest = {
        type: "render",
        requestId,
        source: request.source,
        defines: request.defines,
      };
      worker.postMessage(message);

      const staleWorker = worker;
      timeoutRef.current = setTimeout(() => {
        pendingRef.current = false;
        pendingKeyRef.current = null;
        staleWorker.terminate();
        spawnWorker();
        setState((prev) => ({
          ...prev,
          loading: false,
          error:
            "This design is too complex to preview in the browser and was stopped after 60 seconds. Try simplifying it, or export it anyway — exporting renders on the server instead.",
        }));
      }, RENDER_TIMEOUT_MS);
    }, 0);

    return () => {
      clearTimeout(startTimer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const { renderedKey, ...renderState } = state;
  return {
    ...renderState,
    render,
    hasPendingChanges: key !== request.key,
    isCurrent: renderedKey === key,
  };
}
