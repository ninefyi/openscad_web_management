import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { deleteAdminJobs, listAdminJobs, type AdminJob } from "../api/adminClient";

export function JobsList() {
  const [jobs, setJobs] = useState<AdminJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  function reload() {
    listAdminJobs()
      .then((j) => {
        setJobs(j);
        setSelected(new Set());
      })
      .catch((err: Error) => setError(err.message));
  }

  useEffect(reload, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (jobs && prev.size === jobs.length ? new Set() : new Set(jobs?.map((j) => j.id))));
  }

  async function handleDeleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} job(s)? This can't be undone.`)) return;
    setDeleting(true);
    try {
      await deleteAdminJobs([...selected]);
      reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Couldn't delete the selected jobs.");
    } finally {
      setDeleting(false);
    }
  }

  const activeCount = jobs?.filter((j) => j.status === "queued" || j.status === "rendering").length ?? 0;

  return (
    <div className="admin-list">
      <header className="admin-header">
        <h1>Admin · Export Jobs</h1>
        <div className="admin-header-actions">
          <Link className="admin-link" to="/admin">
            Templates
          </Link>
          <button className="admin-link" onClick={reload}>
            Refresh
          </button>
          <button
            className="admin-delete-button"
            disabled={selected.size === 0 || deleting}
            onClick={handleDeleteSelected}
          >
            Delete selected ({selected.size})
          </button>
        </div>
      </header>

      {error && <p className="gallery-error">{error}</p>}
      {!error && !jobs && <p className="gallery-loading">Loading…</p>}

      {jobs && (
        <>
          <p className="template-description">
            {activeCount > 0 ? `${activeCount} running now, ` : ""}
            {jobs.length} shown (most recent 100).
          </p>
          <table className="admin-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={jobs.length > 0 && selected.size === jobs.length}
                    onChange={toggleAll}
                  />
                </th>
                <th>Status</th>
                <th>Template</th>
                <th>Format</th>
                <th>Created</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(j.id)}
                      onChange={() => toggle(j.id)}
                    />
                  </td>
                  <td>{j.status}</td>
                  <td>{j.template_id ?? "—"}</td>
                  <td>{j.format}</td>
                  <td>{new Date(j.created_at).toLocaleString()}</td>
                  <td className="admin-table-description">{j.error ?? ""}</td>
                </tr>
              ))}
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={6} className="admin-table-empty">
                    No Export Jobs yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
