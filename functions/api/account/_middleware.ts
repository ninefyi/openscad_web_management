import type { Env, AccountData } from "../../lib/env";
import { loadAccountFromRequest } from "../../lib/accountSession";

// Same 401-or-attach-to-context.data shape as functions/api/admin/_middleware.ts,
// but a fully independent tree — this never touches Admin's Cloudflare
// Access flow, and vice versa (see CONTEXT.md: Account, Admin).
export const onRequest: PagesFunction<Env> = async (context) => {
  const account = await loadAccountFromRequest(context.request, context.env.DB);
  if (!account) {
    return Response.json({ error: "Not signed in" }, { status: 401 });
  }

  (context.data as AccountData).account = account;
  return context.next();
};
