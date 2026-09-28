import { useEffect, useRef, useState } from "react";
import type { BufferGeometry } from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { pollUntilSettled } from "../api/exportClient";

export interface ServerPreviewState {
  geometry: BufferGeometry | null;
  working: boolean;
  message: string | null;
  error: string | null;
  /** The `key` the displayed geometry was rendered from, if one was given. */
  renderedKey: string | null;
}

/**
 * Drives an on-demand server-side Render used purely to refresh the Viewer
 * — not a customer Export (nothing gets downloaded) or an Admin Publish
 * validation, just the fast Manifold path standing in for a client-side
 * preview too expensive to attempt automatically (see CONTEXT.md: Render,
 * "Render on server"). The caller supplies how to submit the job (customer
 * Export Job vs. Admin's raw-source render) — this hook only owns polling,
 * STL parsing, and disposing the geometry it produced once it's replaced
 * or the component unmounts.
 *
 * `key` identifies the render's inputs. A run whose key matches one
 * already in flight is ignored, and one matching the last successful run
 * just re-shows that result — so clicking Render again without changing
 * anything never submits a new server job. A failed run is always retried.
 */
export function useServerPreview(): ServerPreviewState & {
  run: (submit: () => Promise<{ jobId: string }>, key?: string) => Promise<void>;
} {
  const [state, setState] = useState<ServerPreviewState>({
    geometry: null,
    working: false,
    message: null,
    error: null,
    renderedKey: null,
  });

  const geometryRef = useRef<BufferGeometry | null>(null);
  const loaderRef = useRef(new STLLoader());
  const runIdRef = useRef(0);
  const inFlightKeyRef = useRef<string | null>(null);
  const doneKeyRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      // Bumping runId makes every `runId !== runIdRef.current` check below
      // fail from here on, so an in-flight run's poll loop (still ticking
      // against /api/jobs — pollUntilSettled has no cancellation) stops
      // acting on its results once this component is gone, instead of
      // parsing an STL or calling setState nobody's listening to anymore.
      runIdRef.current++;
      geometryRef.current?.dispose();
    },
    [],
  );

  async function run(submit: () => Promise<{ jobId: string }>, key?: string) {
    if (key !== undefined) {
      if (key === inFlightKeyRef.current) return;
      if (key === doneKeyRef.current && geometryRef.current) {
        runIdRef.current++; // drop any other run still in flight — these inputs win
        inFlightKeyRef.current = null;
        setState({
          geometry: geometryRef.current,
          working: false,
          message: null,
          error: null,
          renderedKey: key,
        });
        return;
      }
    }

    const runId = ++runIdRef.current;
    inFlightKeyRef.current = key ?? null;
    setState((prev) => ({ ...prev, working: true, message: "Preparing…", error: null }));

    try {
      const { jobId } = await submit();
      const result = await pollUntilSettled(jobId, (status) => {
        if (runId !== runIdRef.current) return;
        if (status.status === "queued") {
          setState((prev) => ({
            ...prev,
            message:
              status.aheadInQueue > 0
                ? `In queue — ${status.aheadInQueue} ahead…`
                : "In queue…",
          }));
        } else if (status.status === "rendering") {
          setState((prev) => ({ ...prev, message: "Rendering on the server…" }));
        }
      });
      if (runId !== runIdRef.current) return; // superseded by a newer run

      if (result.status !== "done" || !result.downloadUrl) {
        inFlightKeyRef.current = null;
        setState((prev) => ({
          ...prev,
          working: false,
          message: null,
          error: result.error ?? "Server render failed.",
        }));
        return;
      }

      const res = await fetch(result.downloadUrl);
      if (!res.ok) throw new Error("Couldn't fetch the rendered file.");
      const stl = await res.arrayBuffer();
      if (runId !== runIdRef.current) return;

      const geometry = loaderRef.current.parse(stl);
      geometryRef.current?.dispose();
      geometryRef.current = geometry;
      inFlightKeyRef.current = null;
      doneKeyRef.current = key ?? null;
      setState({ geometry, working: false, message: null, error: null, renderedKey: key ?? null });
    } catch (err) {
      if (runId !== runIdRef.current) return;
      inFlightKeyRef.current = null;
      setState((prev) => ({
        ...prev,
        working: false,
        message: null,
        error: err instanceof Error ? err.message : "Server render failed.",
      }));
    }
  }

  return { ...state, run };
}
