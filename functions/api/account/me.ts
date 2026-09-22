import type { Env, AccountData } from "../../lib/env";

export const onRequestGet: PagesFunction<Env, string, AccountData> = async ({ data }) => {
  return Response.json(data.account);
};
