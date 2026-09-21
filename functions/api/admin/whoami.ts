import type { Env, AdminData } from "../../lib/env";

export const onRequestGet: PagesFunction<Env, string, AdminData> = async ({ data }) => {
  return Response.json({ email: data.admin.email });
};
