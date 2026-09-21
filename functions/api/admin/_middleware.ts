import type { Env } from "../../lib/env";
import { verifyAdmin } from "../../lib/auth";

export const onRequest: PagesFunction<Env> = async (context) => {
  const admin = await verifyAdmin(context.request, context.env);
  if (!admin) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  (context.data as { admin: { email: string } }).admin = admin;
  return context.next();
};
