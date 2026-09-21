FROM node:22-slim

# openscad: the actual render engine — native, not the WASM build the
# frontend uses (see docs/v2-deploy.md and CONTEXT.md: Render).
# fonts-liberation + fonts-noto-core: kept in sync with the fonts vendored
# into public/openscad/ for the client-side WASM build (see ADR: parity
# discipline) — Liberation matches openscad-wasm's own bundle, Noto Sans
# Thai (part of fonts-noto-core) matches public/openscad/fonts-extra/.
# Add to both places together if a future template needs another script.
RUN apt-get update && apt-get install -y --no-install-recommends \
    openscad \
    fonts-liberation \
    fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.js ./

EXPOSE 8080
CMD ["node", "server.js"]
