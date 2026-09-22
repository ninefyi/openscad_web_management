import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listSavedDesigns, deleteSavedDesign, type SavedDesign } from "../api/accountClient";
import { listBuiltinTemplates } from "../api/client";

export function MyDesigns() {
  const [designs, setDesigns] = useState<SavedDesign[] | null>(null);
  const [templateNames, setTemplateNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function reload() {
    listSavedDesigns()
      .then(setDesigns)
      .catch((err: Error) => setError(err.message));
  }

  useEffect(reload, []);
  useEffect(() => {
    listBuiltinTemplates().then((templates) => {
      setTemplateNames(Object.fromEntries(templates.map((t) => [t.id, t.name])));
    });
    // Templates the Admin has since unlisted (see CONTEXT.md: Listed) won't
    // be in this map — falls back to the raw id below rather than failing.
  }, []);

  async function handleDelete(id: string, label: string) {
    if (!confirm(`Delete "${label}"? This can't be undone.`)) return;
    setDeletingId(id);
    try {
      await deleteSavedDesign(id);
      reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Couldn't delete this design.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="account-page">
      <h1>My designs</h1>

      {error && <p className="account-error">{error}</p>}
      {!error && !designs && <p className="gallery-loading">Loading…</p>}

      {designs && designs.length === 0 && (
        <p className="account-page-subtitle">
          Nothing saved yet — open a design from the{" "}
          <Link to="/">Gallery</Link> and click Save design.
        </p>
      )}

      {designs && designs.length > 0 && (
        <ul className="my-designs-list">
          {designs.map((d) => {
            const templateName = templateNames[d.templateId] ?? d.templateId;
            const label = d.name || templateName;
            return (
              <li key={d.id} className="my-designs-item">
                <Link to={`/t/${d.templateId}?designId=${d.id}`} className="my-designs-link">
                  <span className="my-designs-name">{label}</span>
                  {d.name && <span className="my-designs-template">{templateName}</span>}
                  <span className="my-designs-updated">
                    Updated {new Date(d.updatedAt).toLocaleString()}
                  </span>
                </Link>
                <button
                  className="admin-delete-button"
                  disabled={deletingId === d.id}
                  onClick={() => handleDelete(d.id, label)}
                >
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
