import type { Env } from "../../lib/env";
import type { AccountRow } from "../../lib/accounts";
import { verifyPassword } from "../../lib/accountAuth";
import { createSession, setSessionCookieHeader } from "../../lib/accountSession";

interface LoginRequest {
  email: string;
  password: string;
}

const INVALID_CREDENTIALS_ERROR = "Invalid email or password.";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as Partial<LoginRequest>;
  const email = body.email?.trim().toLowerCase();
  const password = body.password;

  if (!email || !password) {
    return Response.json({ error: "email and password are required" }, { status: 400 });
  }

  const account = await env.DB.prepare("SELECT * FROM accounts WHERE email = ?")
    .bind(email)
    .first<AccountRow>();

  // Same error either way — don't let a caller distinguish "no such
  // account" from "wrong password."
  if (!account || !(await verifyPassword(password, account.password_hash))) {
    return Response.json({ error: INVALID_CREDENTIALS_ERROR }, { status: 401 });
  }

  const sessionId = await createSession(env.DB, account.id);

  return Response.json(
    { id: account.id, name: account.name, email: account.email },
    { headers: { "Set-Cookie": setSessionCookieHeader(sessionId, env) } },
  );
};
