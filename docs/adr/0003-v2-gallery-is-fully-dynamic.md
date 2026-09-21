# v2's public Gallery and Customize view are fully dynamic, not rebuild-on-publish

In v2, the public-facing Gallery and Customize view fetch the Built-in Template list and source from D1 via the Worker on every request, rather than the app being statically generated at build time. An Admin's Publish is visible to end users immediately — no redeploy, no rebuild step in between.

We considered a static-with-rebuild model instead: keep D1 as the Admin's source of truth, but generate the public site as static files, with Publish triggering a Cloudflare Pages rebuild (via a deploy hook) rather than serving live. That would have kept v2's public site as cacheable and backend-independent as v1's, at the cost of publish-to-live latency of roughly 30-60 seconds (a full rebuild) instead of immediate.

We chose fully dynamic for the immediacy — but it means v2's public site is no longer a pure static site the way v1 is: every Gallery and Customize page load now depends on the Worker and D1 being up, and, absent edge caching, includes a database round-trip that v1 never had. If that trade-off turns out to matter (latency, D1 load, or wanting v1's static-site resilience back), the static-with-rebuild model is the fallback — it doesn't require changing anything about how the Admin Panel or D1 schema work, only how the public read path is served.
