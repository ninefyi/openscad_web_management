# Deploying OpenSCAD Web Management to Cloudflare

Everything in this repo is ready to go — the pieces below all need your Cloudflare account and can't be done from here. Run them from the `main` branch, in order.

## 1. Log in

```bash
npx wrangler login
```

Opens a browser window to authorize Wrangler against your Cloudflare account.

## 2. Create the D1 database

```bash
npx wrangler d1 create openscad-web-management
```

This prints a `database_id`. Paste it into [`wrangler.toml`](../wrangler.toml), replacing `REPLACE_WITH_D1_DATABASE_ID`.

Then apply the schema and seed the 3 starter templates:

```bash
npm run d1:migrate:remote
npm run d1:seed:remote
```

## 3. Create the R2 bucket (thumbnails)

```bash
npx wrangler r2 bucket create openscad-web-management-thumbnails
```

No further config needed — [`wrangler.toml`](../wrangler.toml) already binds it as `THUMBNAILS`.

## 4. Create the Pages project

```bash
npx wrangler pages project create openscad-web-management
```

Then either deploy directly:

```bash
npm run build
npx wrangler pages deploy dist
```

...or connect the `main` branch to this project in the Cloudflare dashboard for git-push deploys (build command `npm run build`, output directory `dist`).

## 5. Protect the Admin Panel with Cloudflare Access

In the [Zero Trust dashboard](https://one.dash.cloudflare.com/) → Access → Applications → **Add an application** → **Self-hosted**:

- Domain: your Pages deployment's domain, path `/admin*`
- Add a second path rule (or a second application) for `/api/admin*` — the Admin Panel's API calls need to be covered too, not just the page itself
- Policy: **Allow**, rule "Emails" → your own email address (add more emails later if other admins join)

After saving, open the application's **Overview** tab and copy:

- **Application Audience (AUD) Tag** → `ACCESS_AUD` in [`wrangler.toml`](../wrangler.toml)
- Your Zero Trust **team domain** (`<your-team>.cloudflareaccess.com`) → `ACCESS_TEAM_DOMAIN`

Redeploy after updating these (`npx wrangler pages deploy dist`) so the Worker picks them up.

## 6. Verify

- Visit `/` — the Gallery should load the 3 seeded templates.
- Visit `/admin` — Access should prompt you to log in (one-time code to your email, or whatever identity provider you configured); once through, you should land on the Admin list.
- From a browser where you're *not* logged into Access (e.g. a private window), `/admin` should be blocked by Access before it ever reaches the app.

## Local development

None of the above is needed for local dev — `npm run pages:dev` runs everything against a local D1/R2 emulation and bypasses Access entirely (see `ENVIRONMENT=development` in [`.dev.vars`](../.dev.vars), and [`functions/lib/auth.ts`](../functions/lib/auth.ts)'s local-dev bypass). First-time local setup:

```bash
npm run d1:migrate:local
npm run d1:seed:local
npm run pages:dev
```
