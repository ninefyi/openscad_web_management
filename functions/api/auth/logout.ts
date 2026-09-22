import type { Env } from "../../lib/env";
import { getSessionCookie, clearSessionCookieHeader } from "../../lib/accountSession";

// Idempotent — logging out with no active session (or an already-expired
// one) is still a success, not an error.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const sessionId = getSessionCookie(request);
  if (sessionId) {
    await env.DB.prepare("DELETE FROM account_sessions WHERE id = ?").bind(sessionId).run();
  }
  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": clearSessionCookieHeader(env) } },
  );
};
