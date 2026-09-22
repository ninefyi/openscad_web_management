import type { Env, AccountData } from "../../../lib/env";
import { toSavedDesignDTO, type SavedDesignRow } from "../../../lib/accounts";

interface CreateDesignRequest {
  templateId: string;
  name?: string;
  configuration: Record<string, unknown>;
}

export const onRequestGet: PagesFunction<Env, string, AccountData> = async ({ env, data }) => {
  const { results } = await env.DB.prepare(
    "SELECT * FROM saved_designs WHERE account_id = ? ORDER BY updated_at DESC",
  )
    .bind(data.account.id)
    .all<SavedDesignRow>();
  return Response.json(results.map(toSavedDesignDTO));
};

export const onRequestPost: PagesFunction<Env, string, AccountData> = async ({
  request,
  env,
  data,
}) => {
  const body = (await request.json()) as Partial<CreateDesignRequest>;

  if (!body.templateId || !body.configuration) {
    return Response.json(
      { error: "templateId and configuration are required" },
      { status: 400 },
    );
  }

  const template = await env.DB.prepare("SELECT id FROM templates WHERE id = ?")
    .bind(body.templateId)
    .first();
  if (!template) {
    return Response.json({ error: "Template not found" }, { status: 404 });
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO saved_designs (id, account_id, template_id, name, configuration, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      data.account.id,
      body.templateId,
      body.name?.trim() || null,
      JSON.stringify(body.configuration),
      now,
      now,
    )
    .run();

  const row = await env.DB.prepare("SELECT * FROM saved_designs WHERE id = ?")
    .bind(id)
    .first<SavedDesignRow>();

  return Response.json(toSavedDesignDTO(row!), { status: 201 });
};
