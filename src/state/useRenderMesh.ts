import { useEffect, useRef, useState } from "react";
import type { BufferGeometry } from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import type { Configuration, Parameter, Template } from "../types/template";
import { serializeValue } from "../worker/serializeValue";
import type { RenderRequest, RenderResponse } from "../worker/render.worker";

const DEBOUNCE_MS = 400;
const MAX_CACHE_ENTRIES = 10;

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
  /** True when the caller passed skipAutoRender and the user hasn't opted
   * in yet — the client-side render was never attempted, not merely still
   * running. Distinguishes "we didn't try" from "we're trying." */
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

/**
 * Renders a Template + Configuration into a Mesh via the render Worker,
 * debounced, keeping the last valid geometry on screen through a failed
 * Render (see ADR-0001 / CONTEXT.md: Render). Identical (source, defines)
 * pairs are served from an in-memory cache instead of re-running the Worker
 * — cheap, since flipping a checkbox back and forth or undoing a slider
 * drag is common and openscad-wasm has no reason to redo work it's already
 * done for this exact Configuration.
 *
 * `skipAutoRender` (set by the caller from estimateComplexity's
 * hasExpensiveLoop) holds off the automatic client-side attempt entirely
 * for a design in the class that can hang the tab for the full
 * RENDER_TIMEOUT_MS before surfacing anything — the caller shows a
 * call-to-action instead of a spinner, and `renderInBrowser()` is the
 * user's explicit opt-in to try anyway. Once opted in for a given
 * Template, subsequent Configuration changes render normally (including
 * through the cache) without asking again.
 *
 * `useDefaultPreviewCache` races a fetch of the Template's precomputed
 * default-Configuration preview (see ADR-0010) against the normal
 * client-side Render, but only on the very first render for this Template
 * instance and only when the current Configuration IS the Template's own
 * default — otherwise there's nothing at that cache key to find, or (for
 * the Admin Panel) the cache could be stale against unsaved edits (see
 * ADR-0009). A hit wins (near-instant, and cheap enough to override
 * skipAutoRender's gate too, since fetching isn't the compute that gate
 * protects against); a miss (never warmed, or a network error) just lets
 * the already-running client render finish untouched, at zero extra cost.
 *
 * `requireManualTrigger` (customer-facing Customize view only — see
 * ADR-0013) still auto-renders the very first time for a given Template
 * (so the default-preview cache above keeps paying off on first paint),
 * but a Configuration change after that only marks `hasPendingChanges`
 * true instead of firing anything — no debounce timer, no Worker, no
 * network — until the caller calls `render()`. A render fired that way
 * skips the debounce delay entirely (a click is already a single,
 * deliberate action; there's nothing left to debounce against once
 * Configuration changes no longer auto-fire).
 */
export function useRenderMesh(
  template: Template,
  config: Configuration,
  skipAutoRender = false,
  useDefaultPreviewCache = false,
  requireManualTrigger = false,
): RenderState & { renderInBrowser: () => void; render: () => void; hasPendingChanges: boolean } {
  const [state, setState] = useState<RenderState>({
    geometry: null,
    loading: !skipAutoRender,
    error: null,
    skipped: skipAutoRender,
  });
  const [hasPendingChanges, setHasPendingChanges] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const pendingRef = useRef(false);
  const pendingKeyRef = useRef<string | null>(null);
  const loaderRef = useRef(new STLLoader());
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cacheRef = useRef<Map<string, BufferGeometry>>(new Map());
  const forcedRef = useRef(false);
  const prevSourceRef = useRef(template.source);
  const [forceTick, setForceTick] = useState(0);
  const isFirstForTemplateRef = useRef(true);
  const lastFiredKeyRef = useRef<string | null>(null);
  const pendingManualRef = useRef(false);
  const [manualTick, setManualTick] = useState(0);

  function clearPendingTimeout() {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }

  function rememberGeometry(key: string, geometry: BufferGeometry) {
    const cache = cacheRef.current;
    cache.delete(key);
    cache.set(key, geometry);
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

      if (msg.ok) {
        const geometry = loaderRef.current.parse(msg.stl);
        if (pendingKeyRef.current) rememberGeometry(pendingKeyRef.current, geometry);
        setState({ geometry, loading: false, error: null, skipped: false });
      } else {
        setState((prev) => ({ ...prev, loading: false, error: msg.error, skipped: false }));
      }
      pendingKeyRef.current = null;
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

  // A new design gets a fresh opt-in prompt even if the previous one was
  // accepted — accepting the risk for one Template shouldn't silently carry
  // over to a different one. Same reasoning for isFirstForTemplateRef: a
  // swapped-in Template's first Render should auto-fire again, not inherit
  // "already rendered once" from whatever the hook was last showing.
  useEffect(() => {
    if (prevSourceRef.current !== template.source) {
      prevSourceRef.current = template.source;
      forcedRef.current = false;
      isFirstForTemplateRef.current = true;
      lastFiredKeyRef.current = null;
    }
  }, [template.source]);

  function renderInBrowser() {
    forcedRef.current = true;
    setForceTick((t) => t + 1);
  }

  function render() {
    pendingManualRef.current = true;
    setManualTick((t) => t + 1);
  }

  useEffect(() => {
    const defines = buildDefines(template.parameters, config);
    const key = cacheKey(template.source, defines);
    // A Template's own declared defaults ARE what buildDefines falls back to
    // for any Parameter missing from config — so the default Configuration's
    // key is just what buildDefines produces from an empty config.
    const isDefaultConfig = key === cacheKey(template.source, buildDefines(template.parameters, {}));
    // Captured before isFirstForTemplateRef is (maybe) flipped below — the
    // cache at /api/templates/:id/default-preview only reflects whatever
    // was true as of the last Save, so it's only trustworthy on the very
    // first render for this Template instance, before any edit (source or
    // Configuration) could have happened. Without this, an Admin editing
    // unsaved draft source could dial a Configuration back to matching
    // "default" and get served a stale, previously-Saved STL instead of a
    // render of their actual draft — see ADR-0009.
    const isFirstRenderForTemplate = isFirstForTemplateRef.current;
    const controller = new AbortController();

    // Races a fetch of the precomputed default-preview cache (ADR-0010)
    // against whatever the caller schedules next — a hit wins outright
    // (cheap enough to override skipAutoRender's gate too, since fetching
    // isn't the compute that gate protects against); a miss is a silent
    // no-op, leaving whatever's already scheduled to carry on untouched.
    function tryDefaultPreviewCache(requestId: number) {
      if (!useDefaultPreviewCache || !isDefaultConfig || !isFirstRenderForTemplate) return;
      fetch(`/api/templates/${template.id}/default-preview`, { signal: controller.signal })
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error("miss"))))
        .then((buf) => {
          if (requestId !== requestIdRef.current) return; // superseded or already won
          const geometry = loaderRef.current.parse(buf);
          rememberGeometry(key, geometry);
          requestIdRef.current++; // invalidate whatever else is still in flight
          setState({ geometry, loading: false, error: null, skipped: false });
        })
        .catch(() => {});
    }

    if (skipAutoRender && !forcedRef.current) {
      const requestId = ++requestIdRef.current;
      setState({ geometry: null, loading: false, error: null, skipped: true });
      tryDefaultPreviewCache(requestId);
      return () => controller.abort();
    }

    // Manual-trigger mode (ADR-0013): the first Render for this Template
    // still auto-fires below, but a Configuration change after that — one
    // this effect run wasn't caused by an explicit render() call — just
    // marks the current Mesh stale instead of firing anything.
    const isManualFire = pendingManualRef.current;
    pendingManualRef.current = false;
    if (requireManualTrigger && !isFirstForTemplateRef.current && !isManualFire) {
      setHasPendingChanges(key !== lastFiredKeyRef.current);
      return () => controller.abort();
    }
    isFirstForTemplateRef.current = false;
    lastFiredKeyRef.current = key;
    setHasPendingChanges(false);

    const cached = cacheRef.current.get(key);
    if (cached) {
      cacheRef.current.delete(key);
      cacheRef.current.set(key, cached); // bump to most-recently-used
      requestIdRef.current++; // invalidate any response still in flight
      setState({ geometry: cached, loading: false, error: null, skipped: false });
      return () => controller.abort();
    }

    // This exact Render is already running (e.g. Render (browser) clicked
    // mid-auto-render) — let it finish instead of killing identical work.
    if (pendingRef.current && pendingKeyRef.current === key) {
      return () => controller.abort();
    }

    const requestId = ++requestIdRef.current;
    setState((prev) => ({ ...prev, loading: true, skipped: false }));
    tryDefaultPreviewCache(requestId);

    // A render fired by an explicit click (or the first auto-fire) is
    // already a single, deliberate trigger — nothing left to debounce
    // against, unlike a rapid slider drag in the auto-render mode.
    const debounceMs = requireManualTrigger ? 0 : DEBOUNCE_MS;
    const debounceTimer = setTimeout(() => {
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
      pendingKeyRef.current = key;
      const request: RenderRequest = {
        type: "render",
        requestId,
        source: template.source,
        defines,
      };
      worker.postMessage(request);

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
    }, debounceMs);

    return () => {
      clearTimeout(debounceTimer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, config, skipAutoRender, forceTick, useDefaultPreviewCache, requireManualTrigger, manualTick]);

  return { ...state, renderInBrowser, render, hasPendingChanges };
}
