-- Account: a free end-user identity (see CONTEXT.md). Deliberately separate
-- from Admin (see functions/lib/auth.ts) — Admin auth goes through
-- Cloudflare Access and has no password; Accounts are a parallel,
-- self-service system with their own password hashing and sessions below.
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  -- PBKDF2-SHA256 hash, see functions/lib/accountAuth.ts. Format:
  -- "pbkdf2-sha256:<iterations>:<base64 salt>:<base64 derived key>" —
  -- self-describing so the iteration count can be raised later without a
  -- migration or invalidating existing hashes.
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_accounts_email ON accounts (email);

-- Account session: an opaque, revocable login session (see CONTEXT.md).
-- Deliberately a DB-backed opaque token, not a stateless JWT — this app has
-- no KV namespace and already leans on D1 for everything else (rate
-- limits, export jobs), and a DB row makes logout/revocation a single
-- DELETE instead of needing a JWT blocklist.
CREATE TABLE account_sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_account_sessions_account_id ON account_sessions (account_id);

-- Saved Design: a Template + Configuration an Account has saved (see
-- CONTEXT.md) — the persisted counterpart to the otherwise browser-only
-- Configuration. template_id has no FK constraint (D1/SQLite FKs aren't
-- enforced by default and this app doesn't turn them on elsewhere either —
-- see export_jobs.template_id for precedent), so an Admin deleting or
-- unlisting a Built-in Template later doesn't hard-fail a customer's old
-- Saved Design.
CREATE TABLE saved_designs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  template_id TEXT NOT NULL,
  name TEXT,
  configuration TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_saved_designs_account_id ON saved_designs (account_id, updated_at);
