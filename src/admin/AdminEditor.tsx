import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Configuration, Template } from "../types/template";
import { parseCustomizer } from "../customizer/parseCustomizer";
import { estimateComplexity, complexityMessage } from "../customizer/estimateComplexity";
import { applyManifest, type TemplateManifest } from "../templates/applyManifest";
import { defaultConfiguration } from "../templates/defaultConfiguration";
import { useRenderMesh } from "../state/useRenderMesh";
import { Viewer } from "../components/Customize/Viewer";
import { ParameterPanel } from "../components/Customize/ParameterPanel";
import { fetchTemplateDetail } from "../api/client";
import { createTemplate, updateTemplate, deleteTemplate, uploadThumbnail } from "../api/adminClient";

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

  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (isNew) return;
    fetchTemplateDetail(id).then(
      (detail) => {
        setName(detail.name);
        setDescription(detail.description ?? "");
        setSource(detail.source);
        setLabels(detail.manifest.labels);
        setHide(detail.manifest.hide);
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
  const complexityHint = useMemo(
    () => complexityMessage(estimateComplexity(source)),
    [source],
  );

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

  const { geometry, loading: rendering, error: renderError } = useRenderMesh(
    draftTemplate,
    config,
  );
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);

  const canPublish =
    !loading && !rendering && !renderError && geometry !== null && name.trim() !== "";

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
    setSaving(true);
    setSaveError(null);
    try {
      const input = {
        name: name.trim(),
        description: description.trim() || undefined,
        source,
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
      setSaving(false);
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
          <button className="export-button" disabled={!canPublish || saving} onClick={handlePublish}>
            {saving ? "Publishing…" : "Publish"}
          </button>
        </div>
      </header>

      {saveError && <p className="gallery-error">{saveError}</p>}
      {!rendering && renderError && (
        <p className="admin-render-error">
          Won't publish until this renders successfully: {renderError}
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
            loading={rendering}
            error={renderError}
            color={PREVIEW_COLOR}
            complexityMessage={complexityHint}
            onCanvasReady={(canvas) => (canvasElRef.current = canvas)}
          />
          {complexityHint && <p className="complexity-hint">{complexityHint}</p>}
          <div className="admin-editor-params">
            <ParameterPanel parameters={appliedParams} config={config} onChange={handleConfigChange} />
          </div>
        </div>
      </div>
    </div>
  );
}
