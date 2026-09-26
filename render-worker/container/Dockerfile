FROM node:22-slim

# openscad-nightly (not Debian's packaged `openscad`, which is stuck at
# 2021.01): pulls in the Manifold geometry backend, which is 5-30x faster
# than CGAL — see docs/adr/0006-manifold-backend-for-server-side-render.md
# (the server side) and docs/adr/0011-client-side-manifold-backend.md (the
# client-side WASM preview, which moved to Manifold too — both now agree).
# Nightly repo is Debian-12-only right now, which
# matches this base image (bookworm) — see
# https://openscad.org/downloads.html#snapshots if that ever needs bumping.
# Symlinked to `openscad` so server.js doesn't need to know the package name.
#
# fonts-liberation + fonts-noto-core: kept in sync with the fonts vendored
# into public/openscad/ for the client-side WASM build (see ADR: parity
# discipline) — Liberation matches openscad-wasm's own bundle, Noto Sans
# Thai (part of fonts-noto-core) matches public/openscad/fonts-extra/.
# Add to both places together if a future template needs another script.
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget gnupg ca-certificates \
    && wget -qO /etc/apt/trusted.gpg.d/obs-openscad-nightly.asc \
    https://files.openscad.org/OBS-Repository-Key.pub \
    && echo "deb https://download.opensuse.org/repositories/home:/t-paul/Debian_12/ ./" \
    > /etc/apt/sources.list.d/openscad-nightly.list \
    && apt-get update && apt-get install -y --no-install-recommends \
    openscad-nightly \
    fonts-liberation \
    fonts-noto-core \
    && ln -s /usr/bin/openscad-nightly /usr/local/bin/openscad \
    && apt-get purge -y wget gnupg \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.js ./

EXPOSE 8080
CMD ["node", "server.js"]
