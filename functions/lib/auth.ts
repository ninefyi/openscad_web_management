import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./env";

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJWKS(teamDomain: string) {
  let jwks = jwksCache.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    jwksCache.set(teamDomain, jwks);
  }
  return jwks;
}

/**
 * Verifies the Cloudflare Access JWT that Access attaches to every request
 * once it's protecting this path (see docs/v2-deploy.md). Returns the
 * authenticated Admin's email, or null if the request isn't authenticated.
 *
 * Local dev has no Access edge in front of it, so `ENVIRONMENT !== "production"`
 * bypasses verification entirely with a fixed local identity — this must
 * never be reachable in a real deployment, which is why it's keyed off the
 * `vars.ENVIRONMENT` set in wrangler.toml, not a client-controlled value.
 */
export async function verifyAdmin(
  request: Request,
  env: Env,
): Promise<{ email: string } | null> {
  if (env.ENVIRONMENT !== "production") {
    return { email: "local-admin@localhost" };
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getJWKS(env.ACCESS_TEAM_DOMAIN), {
      audience: env.ACCESS_AUD,
      issuer: `https://${env.ACCESS_TEAM_DOMAIN}`,
    });
    if (typeof payload.email !== "string") return null;
    return { email: payload.email };
  } catch {
    return null;
  }
}
