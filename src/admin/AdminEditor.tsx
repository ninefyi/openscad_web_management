import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Mesh } from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import type { Configuration, Template } from "../types/template";
import { parseCustomizer } from "../customizer/parseCustomizer";
import { estimateComplexity, complexityMessage } from "../customizer/estimateComplexity";
import { applyManifest, type TemplateManifest } from "../templates/applyManifest";
import { defaultConfiguration } from "../templates/defaultConfiguration";
import { useRenderMesh } from "../state/useRenderMesh";
import { useServerPreview } from "../state/useServerPreview";
import { Viewer } from "../components/Customize/Viewer";
import { ParameterPanel } from "../components/Customize/ParameterPanel";
import { ImageCarousel } from "./ImageCarousel";
import {
  createTemplate,
  updateTemplate,
  deleteTemplate,
  uploadThumbnail,
  fetchAdminTemplateDetail,
} from "../api/adminClient";
import {
  submitAdminRender,
  pollUntilSettled,
  visibleConfiguration,
  type ExportFormat,
} from "../api/exportClient";

const PREVIEW_COLOR = "#6366f1";
const PLACEHOLDER_SOURCE = `// A new template — top-level variables become customizable
// parameters automatically. Add a "// [min:max]" comment to turn
// one into a slider, e.g.:

width = 40; // [10:100]

cube([width, width, width]);
`;

function slugify(name: string): string {
  const slug = name.trim().replace(/\s+/g, "-").toLowerCase();
  return slug || "template";
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type ExportState =
  | { phase: "idle" }
  | { phase: "working"; message: string }
  | { phase: "error"; message: string };

export function AdminEditor() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id;
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [source, setSource] = useState(isNew ? PLACEHOLDER_SOURCE : "");
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [hide, setHide] = useState<string[]>([]);
  const [isListed, setIsListed] = useState(true);

  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStage, setSaveStage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("stl");
  const [exportState, setExportState] = useState<ExportState>({ phase: "idle" });

  useEffect(() => {
    if (isNew) return;
    // The admin-only endpoint, not ../api/client's public one — a template
    // that's been unlisted (see CONTEXT.md: Listed) 404s on the public path,
    // but the Admin Panel still needs to load and edit it.
    fetchAdminTemplateDetail(id).then(
      (detail) => {
        setName(detail.name);
        setDescription(detail.description ?? "");
        setSource(detail.source);
        setLabels(detail.manifest.labels);
        setHide(detail.manifest.hide);
        setIsListed(detail.isListed);
        setLoading(false);
      },
      (err: Error) => {
        setLoadError(err.message);
        setLoading(false);
      },
    );
  }, [id, isNew]);

  const parsedParams = useMemo(() => parseCustomizer(source), [source]);
  const manifest: TemplateManifest = useMemo(
    () => ({ labels, order: [], hide }),
    [labels, hide],
  );
  const appliedParams = useMemo(
    () => applyManifest(parsedParams, manifest),
    [parsedParams, manifest],
  );
  const manifestableParams = parsedParams.filter((p) => !p.hidden);
  const complexity = useMemo(() => estimateComplexity(source), [source]);
  const complexityHint = useMemo(() => complexityMessage(complexity), [complexity]);

  const draftTemplate: Template = useMemo(
    () => ({
      id: id ?? "draft",
      name: name || "Untitled",
      source,
      parameters: appliedParams,
    }),
    [id, name, source, appliedParams],
  );

  const [config, setConfig] = useState<Configuration>(() =>
    defaultConfiguration(draftTemplate),
  );
  const paramSignature = appliedParams.map((p) => p.name).join(",");
  useEffect(() => {
    setConfig(defaultConfiguration(draftTemplate));
    // Only reset when the actual set of parameters changes, not on every
    // keystroke — otherwise the admin's test values get wiped constantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramSignature]);

  const {
    geometry: clientGeometry,
    loading: clientLoading,
    error: clientError,
    skipped,
    renderInBrowser,
  } = useRenderMesh(draftTemplate, config, complexity.hasExpensiveLoop);
  const serverPreview = useServerPreview();
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);

  // Render (browser) and Render (server) are both always available — see
  // CONTEXT.md: Render on server, ADR-0008. Whichever the Admin last
  // triggered is what the Viewer shows; a Configuration change falls back
  // to the browser engine (whose auto-render, unless skipped, already
  // reflects the new values — a stale server render from before the
  // change would be misleading to keep showing).
  const [previewSource, setPreviewSource] = useState<"client" | "server">("client");
  useEffect(() => {
    setPreviewSource("client");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const geometry = previewSource === "server" ? serverPreview.geometry : clientGeometry;
  const previewLoading = previewSource === "server" ? serverPreview.working : clientLoading;
  const previewError = previewSource === "server" ? serverPreview.error : clientError;

  const canSave = name.trim() !== "" && saveStage === null;

  function handleRenderInBrowser() {
    setPreviewSource("client");
    renderInBrowser();
  }

  function handleRenderOnServer() {
    setPreviewSource("server");
    serverPreview.run(() => submitAdminRender(source, visibleConfiguration(appliedParams, config)));
  }

  function handleConfigChange(paramName: string, value: Configuration[string]) {
    setConfig((prev) => ({ ...prev, [paramName]: value }));
  }

  function handleLabelChange(paramName: string, label: string) {
    setLabels((prev) => {
      const next = { ...prev };
      if (label.trim()) next[paramName] = label;
      else delete next[paramName];
      return next;
    });
  }

  function toggleHide(paramName: string) {
    setHide((prev) =>
      prev.includes(paramName) ? prev.filter((n) => n !== paramName) : [...prev, paramName],
    );
  }

  // Save persists metadata only — no render check first (see CONTEXT.md:
  // Save, ADR-0009). Use Render (browser)/Render (server) beforehand to
  // check the design actually renders; Save itself doesn't gate on it.
  async function handleSave() {
    setSaveError(null);
    setSaveStage("Saving…");
    try {
      const input = {
        name: name.trim(),
        description: description.trim() || undefined,
        source,
        isListed,
        manifest: { labels, order: [], hide },
      };
      const saved = isNew ? await createTemplate(input) : await updateTemplate(id, input);

      if (canvasElRef.current) {
        const blob = await new Promise<Blob | null>((resolve) =>
          canvasElRef.current!.toBlob(resolve, "image/png"),
        );
        if (blob) await uploadThumbnail(saved.id, blob);
      }

      navigate("/admin");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaveStage(null);
    }
  }

  async function handleDelete() {
    if (!id) return;
    if (!confirm(`Delete "${name}"? This can't be undone.`)) return;
    try {
      await deleteTemplate(id);
      navigate("/admin");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Couldn't delete this template.");
    }
  }

  // STL from whatever the browser already has rendered, when there is one
  // — instant, no Container round-trip. 3MF can only ever come from the
  // server (openscad-wasm has no lib3mf — see ADR-0009), and STL falls
  // back to the server too when the browser has nothing to export yet.
  async function handleExport() {
    setExportState({ phase: "working", message: "Preparing…" });
    try {
      if (exportFormat === "stl" && clientGeometry) {
        const exporter = new STLExporter();
        const data = exporter.parse(new Mesh(clientGeometry), { binary: true });
        triggerDownload(new Blob([data], { type: "model/stl" }), `${slugify(name)}.stl`);
        setExportState({ phase: "idle" });
        return;
      }

      const { jobId } = await submitAdminRender(
        source,
        visibleConfiguration(appliedParams, config),
        exportFormat,
      );
      const final = await pollUntilSettled(jobId, (status) => {
        if (status.status === "queued") {
          setExportState({
            phase: "working",
            message:
              status.aheadInQueue > 0
                ? `In queue — ${status.aheadInQueue} ahead…`
                : "In queue…",
          });
        } else if (status.status === "rendering") {
          setExportState({ phase: "working", message: "Rendering on the server…" });
        }
      });

      if (final.status === "done" && final.downloadUrl) {
        const res = await fetch(final.downloadUrl);
        if (!res.ok) throw new Error("Couldn't fetch the exported file.");
        const blob = await res.blob();
        triggerDownload(blob, `${slugify(name)}.${exportFormat}`);
        setExportState({ phase: "idle" });
      } else {
        setExportState({ phase: "error", message: final.error ?? "Couldn't export this file." });
      }
    } catch (err) {
      setExportState({
        phase: "error",
        message: err instanceof Error ? err.message : "Couldn't export this file.",
      });
    }
  }

  if (loading) return <div className="page-message">Loading…</div>;
  if (loadError) return <div className="page-message">{loadError}</div>;

  return (
    <div className="admin-editor">
      <header className="admin-header">
        <h1>{isNew ? "New Template" : `Edit · ${name || id}`}</h1>
        <div className="admin-header-actions">
          <button className="admin-link" onClick={() => navigate("/admin")}>
            Cancel
          </button>
          {!isNew && (
            <button className="admin-delete-button" onClick={handleDelete}>
              Delete
            </button>
          )}
          <select
            className="admin-export-format"
            value={exportFormat}
            onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
            aria-label="Export format"
          >
            <option value="stl">.STL</option>
            <option value="3mf">.3MF</option>
          </select>
          <button
            className="admin-link"
            onClick={handleExport}
            disabled={exportState.phase === "working"}
          >
            {exportState.phase === "working" ? exportState.message : "Export"}
          </button>
          <button className="export-button" disabled={!canSave} onClick={handleSave}>
            {saveStage ?? "Save"}
          </button>
        </div>
      </header>

      {saveError && <p className="gallery-error">{saveError}</p>}
      {exportState.phase === "error" && (
        <p className="admin-render-error">{exportState.message}</p>
      )}

      <div className="admin-editor-body">
        <div className="admin-editor-source">
          <label className="admin-field">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="admin-field">
            Description
            <input value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label className="admin-field admin-field-checkbox">
            <input
              type="checkbox"
              checked={isListed}
              onChange={(e) => setIsListed(e.target.checked)}
            />
            Listed in Gallery
          </label>
          <label className="admin-field">
            OpenSCAD source
            <textarea
              className="admin-code-editor"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === "Tab") {
                  e.preventDefault();
                  const target = e.currentTarget;
                  const { selectionStart, selectionEnd } = target;
                  const next =
                    source.slice(0, selectionStart) + "  " + source.slice(selectionEnd);
                  setSource(next);
                  requestAnimationFrame(() => {
                    target.selectionStart = target.selectionEnd = selectionStart + 2;
                  });
                }
              }}
            />
          </label>

          {manifestableParams.length > 0 && (
            <div className="admin-manifest-editor">
              <h3>Parameters detected</h3>
              {manifestableParams.map((p) => (
                <div className="admin-manifest-row" key={p.name}>
                  <code>{p.name}</code>
                  <input
                    placeholder={p.label}
                    value={labels[p.name] ?? ""}
                    onChange={(e) => handleLabelChange(p.name, e.target.value)}
                  />
                  <label>
                    <input
                      type="checkbox"
                      checked={hide.includes(p.name)}
                      onChange={() => toggleHide(p.name)}
                    />
                    Hide
                  </label>
                </div>
              ))}
            </div>
          )}

          {id ? (
            <ImageCarousel templateId={id} />
          ) : (
            <p className="parameter-panel-empty">Save this template first to add images.</p>
          )}
        </div>

        <div className="admin-editor-preview">
          <div className="admin-render-toolbar">
            <button className="admin-link" onClick={handleRenderInBrowser}>
              Render (browser)
            </button>
            <button className="admin-link" onClick={handleRenderOnServer}>
              Render (server)
            </button>
          </div>
          <Viewer
            geometry={geometry}
            loading={previewLoading}
            error={previewError}
            color={PREVIEW_COLOR}
            complexityMessage={complexityHint}
            loadingMessage={previewSource === "server" ? serverPreview.message : undefined}
            onCanvasReady={(canvas) => (canvasElRef.current = canvas)}
            emptyState={
              skipped && (
                <p>{complexityHint ?? "This design is complex and may be slow to preview."}</p>
              )
            }
          />
          {complexityHint && !skipped && <p className="complexity-hint">{complexityHint}</p>}
          <div className="admin-editor-params">
            <ParameterPanel parameters={appliedParams} config={config} onChange={handleConfigChange} />
          </div>
        </div>
      </div>
    </div>
  );
}
