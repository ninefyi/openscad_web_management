import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Configuration, Template } from "../types/template";
import { parseCustomizer } from "../customizer/parseCustomizer";
import { estimateComplexity, complexityMessage } from "../customizer/estimateComplexity";
import { applyManifest, type TemplateManifest } from "../templates/applyManifest";
import { defaultConfiguration } from "../templates/defaultConfiguration";
import { useRenderMesh } from "../state/useRenderMesh";
import { useServerPreview } from "../state/useServerPreview";
import { Viewer } from "../components/Customize/Viewer";
import { ParameterPanel } from "../components/Customize/ParameterPanel";
import {
  createTemplate,
  updateTemplate,
  deleteTemplate,
  uploadThumbnail,
  fetchAdminTemplateDetail,
} from "../api/adminClient";
import { submitAdminRender, pollUntilSettled, visibleConfiguration } from "../api/exportClient";

const PREVIEW_COLOR = "#6366f1";
const PLACEHOLDER_SOURCE = `// A new template — top-level variables become customizable
// parameters automatically. Add a "// [min:max]" comment to turn
// one into a slider, e.g.:

width = 40; // [10:100]

cube([width, width, width]);
`;

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
  const [publishStage, setPublishStage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

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
    loading: rendering,
    error: renderError,
    skipped,
    renderInBrowser,
  } = useRenderMesh(draftTemplate, config, complexity.hasExpensiveLoop);
  const serverPreview = useServerPreview();
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);

  // While skipped, the client pipeline never ran (see useRenderMesh) — the
  // on-demand server preview is the only source of "does this look right"
  // feedback, same as it is for the public Customize view.
  const geometry = skipped ? serverPreview.geometry : clientGeometry;
  const previewLoading = skipped ? serverPreview.working : rendering;
  const previewError = skipped ? serverPreview.error : renderError;

  const canPublish =
    !loading &&
    !previewLoading &&
    !previewError &&
    geometry !== null &&
    name.trim() !== "" &&
    publishStage === null;

  function handleRenderOnServer() {
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

  async function handlePublish() {
    setSaveError(null);
    setPublishStage("Validating on the server…");
    try {
      // Confirms the exact server-side Render path (native OpenSCAD in a
      // Container, not the WASM build) also succeeds for this template
      // before it goes live — catches the class of bug that passed the
      // client-side check here but would break every customer's export
      // downstream (see ADR: one render pipeline for all server-side callers).
      const defaultConfig = defaultConfiguration(draftTemplate);
      const { jobId } = await submitAdminRender(
        source,
        visibleConfiguration(appliedParams, defaultConfig),
      );
      const result = await pollUntilSettled(jobId, (status) => {
        if (status.status === "queued") {
          setPublishStage(
            status.aheadInQueue > 0
              ? `In queue — ${status.aheadInQueue} ahead…`
              : "In queue…",
          );
        } else if (status.status === "rendering") {
          setPublishStage("Rendering on the server…");
        }
      });
      if (result.status !== "done") {
        throw new Error(
          result.error ?? "Server-side render failed — won't publish until it succeeds.",
        );
      }

      setPublishStage("Saving…");
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
      setSaveError(err instanceof Error ? err.message : "Couldn't publish.");
    } finally {
      setPublishStage(null);
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
          <button className="export-button" disabled={!canPublish} onClick={handlePublish}>
            {publishStage ?? "Publish"}
          </button>
        </div>
      </header>

      {saveError && <p className="gallery-error">{saveError}</p>}
      {!previewLoading && previewError && (
        <p className="admin-render-error">
          Won't publish until this renders successfully: {previewError}
        </p>
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
        </div>

        <div className="admin-editor-preview">
          <Viewer
            geometry={geometry}
            loading={previewLoading}
            error={previewError}
            color={PREVIEW_COLOR}
            complexityMessage={complexityHint}
            loadingMessage={skipped ? serverPreview.message : undefined}
            onCanvasReady={(canvas) => (canvasElRef.current = canvas)}
            emptyState={
              skipped && (
                <div className="complex-design-cta">
                  <p>{complexityHint ?? "This design is complex and may be slow to preview."}</p>
                  <button className="export-button" onClick={handleRenderOnServer}>
                    Render on server
                  </button>
                  <button className="admin-link" onClick={renderInBrowser}>
                    Render in browser anyway
                  </button>
                </div>
              )
            }
          />
          {complexityHint && !skipped && <p className="complexity-hint">{complexityHint}</p>}
          {skipped && geometry && (
            <p className="complexity-hint">
              Server preview shown — click{" "}
              <button className="link-button" onClick={handleRenderOnServer}>
                Render on server
              </button>{" "}
              again after changing values to refresh it.
            </p>
          )}
          <div className="admin-editor-params">
            <ParameterPanel parameters={appliedParams} config={config} onChange={handleConfigChange} />
          </div>
        </div>
      </div>
    </div>
  );
}
