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

## 3. Create the R2 bucket (thumbnails + exports)

```bash
npx wrangler r2 bucket create openscad-web-management-thumbnails
```

No further config needed — [`wrangler.toml`](../wrangler.toml) already binds it as `THUMBNAILS`. Also holds Export Job STL results, under an `exports/` key prefix — one bucket, not two.

## 4. Create the render Queue

```bash
npx wrangler queues create render-jobs
```

This project (the Pages one) is only the producer — see step 7 for the consumer, which has to live in a separate Worker (Pages Functions can't consume queues).

## 5. Create the Pages project

```bash
npx wrangler pages project create openscad-web-management
```

Then either deploy directly:

```bash
npm run build
npx wrangler pages deploy dist
```

...or connect the `main` branch to this project in the Cloudflare dashboard for git-push deploys (build command `npm run build`, output directory `dist`).

## 6. Protect the Admin Panel with Cloudflare Access

In the [Zero Trust dashboard](https://one.dash.cloudflare.com/) → Access → Applications → **Add an application** → **Self-hosted**:

- Domain: your Pages deployment's domain, path `/admin*`
- Add a second path rule (or a second application) for `/api/admin*` — the Admin Panel's API calls need to be covered too, not just the page itself
- Policy: **Allow**, rule "Emails" → your own email address (add more emails later if other admins join)

After saving, open the application's **Overview** tab and copy:

- **Application Audience (AUD) Tag** → `ACCESS_AUD` in [`wrangler.toml`](../wrangler.toml)
- Your Zero Trust **team domain** (`<your-team>.cloudflareaccess.com`) → `ACCESS_TEAM_DOMAIN`

Redeploy after updating these (`npx wrangler pages deploy dist`) so the Worker picks them up.

**Optional — for admin scripts** (see CONTEXT.md: Export Job / Admin): in the same Access application, add a **Service Auth** policy alongside the email one, and generate a Service Token. Scripts send it as `CF-Access-Client-Id`/`CF-Access-Client-Secret` headers to authenticate against `/api/admin/*` non-interactively — no separate auth system, the same Access application covers both a human in a browser and a script.

## 7. Deploy the render-worker (the actual render engine)

This is a **separate standalone Worker**, not part of the Pages project — see [ADR-0005](./adr/0005-async-export-job-pipeline.md) for why. **Needs Docker running locally** (`docker ps` should not error) — `wrangler deploy` builds the container image from `render-worker/container/Dockerfile` and pushes it to Cloudflare as part of deploying.

```bash
cd render-worker
npm install
```

Paste the same `database_id` from step 2 into `render-worker/wrangler.toml` (it's currently a placeholder there too — both projects bind the same D1 database).

```bash
npx wrangler deploy
```

First deploy takes a few minutes (building + pushing the container image). Once it's up, it starts consuming the `render-jobs` queue automatically — no further wiring needed, `functions/lib/env.ts` in the main project already sends to that same queue.

## 8. Verify

- Visit `/` — the Gallery should load the 3 seeded templates.
- Visit `/admin` — Access should prompt you to log in (one-time code to your email, or whatever identity provider you configured); once through, you should land on the Admin list.
- From a browser where you're *not* logged into Access (e.g. a private window), `/admin` should be blocked by Access before it ever reaches the app.
- Open any template and click **Export STL** — it should show "In queue…"/"Rendering…" for a few seconds to a couple minutes (see CONTEXT.md: Export Job) and then download. If it fails or hangs past ~5 minutes, check `npx wrangler tail` on the `render-worker` project for the actual error — most likely cause is the render-worker not deployed yet, or the two `wrangler.toml`s' `database_id`s not matching.

## Local development

None of the above is needed for local dev — `npm run pages:dev` runs everything against a local D1/R2 emulation and bypasses Access entirely (see `ENVIRONMENT=development` in [`.dev.vars`](../.dev.vars), and [`functions/lib/auth.ts`](../functions/lib/auth.ts)'s local-dev bypass). First-time local setup:

```bash
npm run d1:migrate:local
npm run d1:seed:local
npm run pages:dev
```

Export Jobs will submit and poll correctly against this, but stay `queued` forever — nothing local consumes the queue (`wrangler pages dev` doesn't run `render-worker/`'s consumer). To test the actual render step without Docker at all, run `render-worker/container/server.js` directly with plain Node — it just shells out to a system-installed `openscad` (`brew install openscad` if you don't have one), no container needed for this:

```bash
cd render-worker/container
PORT=8091 node server.js
# in another terminal:
curl -X POST http://127.0.0.1:8091/render -H "content-type: application/json" \
  -d '{"source":"cube([10,10,10]);"}' -o test.stl
```

To exercise the whole pipeline locally, including the queue consumer, run `wrangler dev` inside `render-worker/` too (needs Docker for the actual container step) alongside `npm run pages:dev` in the main project — both point at the same local D1/Queue when run from the same machine.
