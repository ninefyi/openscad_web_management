import type { Env } from "./env";

// "account_session" — deliberately not "session" or "sessionToken", which
// already means the anonymous, unauthenticated per-browser token
// src/api/exportClient.ts uses for export rate limiting (see CONTEXT.md:
// Account session). The two never intersect.
export const SESSION_COOKIE_NAME = "account_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function getSessionCookie(request: Request): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  const match = header
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
  return match ? decodeURIComponent(match.slice(SESSION_COOKIE_NAME.length + 1)) : null;
}

// Secure is omitted outside production because local dev serves plain HTTP
// (wrangler pages dev on localhost) — a browser silently refuses to store a
// Secure cookie over an insecure origin, which would break local testing
// entirely rather than just being a bit less strict.
function cookieAttributes(env: Env, maxAgeSeconds: number): string {
  const parts = ["HttpOnly", "SameSite=Lax", "Path=/", `Max-Age=${maxAgeSeconds}`];
  if (env.ENVIRONMENT === "production") parts.push("Secure");
  return parts.join("; ");
}

export function setSessionCookieHeader(sessionId: string, env: Env): string {
  const maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE_NAME}=${sessionId}; ${cookieAttributes(env, maxAgeSeconds)}`;
}

export function clearSessionCookieHeader(env: Env): string {
  return `${SESSION_COOKIE_NAME}=; ${cookieAttributes(env, 0)}`;
}

export async function createSession(db: D1Database, accountId: string): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db
    .prepare(
      "INSERT INTO account_sessions (id, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    )
    .bind(id, accountId, now.toISOString(), expiresAt.toISOString())
    .run();
  return id;
}
