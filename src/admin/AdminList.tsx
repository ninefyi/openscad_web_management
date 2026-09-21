import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listBuiltinTemplates, type TemplateSummary } from "../api/client";
import { deleteTemplate } from "../api/adminClient";

export function AdminList() {
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function reload() {
    listBuiltinTemplates()
      .then(setTemplates)
      .catch((err: Error) => setError(err.message));
  }

  useEffect(reload, []);

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This can't be undone.`)) return;
    setDeletingId(id);
    try {
      await deleteTemplate(id);
      reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Couldn't delete this template.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="admin-list">
      <header className="admin-header">
        <h1>Admin · Built-in Templates</h1>
        <div className="admin-header-actions">
          <Link className="admin-link" to="/">
            View Gallery
          </Link>
          <Link className="export-button" to="/admin/new">
            + New Template
          </Link>
        </div>
      </header>

      {error && <p className="gallery-error">{error}</p>}
      {!error && !templates && <p className="gallery-loading">Loading…</p>}

      {templates && (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Description</th>
              <th>Updated</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td className="admin-table-description">{t.description}</td>
                <td>{new Date(t.updatedAt).toLocaleString()}</td>
                <td className="admin-table-actions">
                  <Link to={`/admin/${t.id}`}>Edit</Link>
                  <button
                    className="admin-delete-button"
                    disabled={deletingId === t.id}
                    onClick={() => handleDelete(t.id, t.name)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {templates.length === 0 && (
              <tr>
                <td colSpan={4} className="admin-table-empty">
                  No templates yet — create one to populate the Gallery.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
