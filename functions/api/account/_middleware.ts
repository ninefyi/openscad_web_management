import type { Env, AccountData } from "../../lib/env";
import { getSessionCookie } from "../../lib/accountSession";

// Same 401-or-attach-to-context.data shape as functions/api/admin/_middleware.ts,
// but a fully independent tree — this never touches Admin's Cloudflare
// Access flow, and vice versa (see CONTEXT.md: Account, Admin).
export const onRequest: PagesFunction<Env> = async (context) => {
  const sessionId = getSessionCookie(context.request);
  if (!sessionId) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  const row = await context.env.DB.prepare(
    `SELECT accounts.id, accounts.name, accounts.email
     FROM account_sessions
     JOIN accounts ON accounts.id = account_sessions.account_id
     WHERE account_sessions.id = ? AND account_sessions.expires_at > ?`,
  )
    .bind(sessionId, new Date().toISOString())
    .first<{ id: string; name: string; email: string }>();

  if (!row) {
    return Response.json({ error: "Session expired" }, { status: 401 });
  }

  (context.data as AccountData).account = row;
  return context.next();
};
