import type { Env } from "../../lib/env";
import { hashPassword } from "../../lib/accountAuth";
import { createSession, setSessionCookieHeader } from "../../lib/accountSession";

interface SignupRequest {
  name: string;
  email: string;
  password: string;
}

const MIN_PASSWORD_LENGTH = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as Partial<SignupRequest>;

  const name = body.name?.trim();
  const email = body.email?.trim().toLowerCase();
  const password = body.password;

  if (!name || !email || !password) {
    return Response.json({ error: "name, email, and password are required" }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return Response.json({ error: "That doesn't look like a valid email address." }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return Response.json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
      { status: 400 },
    );
  }

  const existing = await env.DB.prepare("SELECT id FROM accounts WHERE email = ?")
    .bind(email)
    .first();
  if (existing) {
    return Response.json(
      { error: "An account with this email already exists." },
      { status: 409 },
    );
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);

  await env.DB.prepare(
    "INSERT INTO accounts (id, name, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(id, name, email, passwordHash, now, now)
    .run();

  const sessionId = await createSession(env.DB, id);

  return Response.json(
    { id, name, email },
    { status: 201, headers: { "Set-Cookie": setSessionCookieHeader(sessionId, env) } },
  );
};
