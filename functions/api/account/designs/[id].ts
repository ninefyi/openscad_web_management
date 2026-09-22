import type { Env, AccountData } from "../../../lib/env";
import { toSavedDesignDTO, type SavedDesignRow } from "../../../lib/accounts";

interface UpdateDesignRequest {
  name?: string;
  configuration: Record<string, unknown>;
}

// Same "not found" response whether the design doesn't exist or belongs to
// a different Account — don't let a caller distinguish the two and probe
// for other accounts' design IDs.
async function loadOwned(
  env: Env,
  id: string,
  accountId: string,
): Promise<SavedDesignRow | null> {
  const row = await env.DB.prepare("SELECT * FROM saved_designs WHERE id = ?")
    .bind(id)
    .first<SavedDesignRow>();
  if (!row || row.account_id !== accountId) return null;
  return row;
}

export const onRequestGet: PagesFunction<Env, string, AccountData> = async ({
  env,
  params,
  data,
}) => {
  const row = await loadOwned(env, params.id as string, data.account.id);
  if (!row) return Response.json({ error: "Design not found" }, { status: 404 });
  return Response.json(toSavedDesignDTO(row));
};

export const onRequestPut: PagesFunction<Env, string, AccountData> = async ({
  request,
  env,
  params,
  data,
}) => {
  const id = params.id as string;
  const existing = await loadOwned(env, id, data.account.id);
  if (!existing) return Response.json({ error: "Design not found" }, { status: 404 });

  const body = (await request.json()) as Partial<UpdateDesignRequest>;
  if (!body.configuration) {
    return Response.json({ error: "configuration is required" }, { status: 400 });
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    "UPDATE saved_designs SET name = ?, configuration = ?, updated_at = ? WHERE id = ?",
  )
    .bind(body.name?.trim() || null, JSON.stringify(body.configuration), now, id)
    .run();

  const row = await env.DB.prepare("SELECT * FROM saved_designs WHERE id = ?")
    .bind(id)
    .first<SavedDesignRow>();
  return Response.json(toSavedDesignDTO(row!));
};

export const onRequestDelete: PagesFunction<Env, string, AccountData> = async ({
  env,
  params,
  data,
}) => {
  const id = params.id as string;
  const existing = await loadOwned(env, id, data.account.id);
  if (!existing) return Response.json({ error: "Design not found" }, { status: 404 });

  await env.DB.prepare("DELETE FROM saved_designs WHERE id = ?").bind(id).run();
  return Response.json({ ok: true });
};
