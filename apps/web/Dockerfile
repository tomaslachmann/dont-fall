# The game and the Track builder behind nginx, with the API under /api on the
# same address (ADR 0108) — what `docker compose up web` serves locally on
# :8088 and a Codespace forwards as its one public link. Build context: the
# repo root, like apps/api/Dockerfile.
FROM node:22-slim AS build
RUN corepack enable
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/render/package.json packages/render/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY apps/client/package.json apps/client/package.json
COPY apps/track-builder/package.json apps/track-builder/package.json
RUN pnpm install --frozen-lockfile --filter @dont-fall/client... --filter @dont-fall/track-builder...

COPY packages packages
COPY apps/client apps/client
COPY apps/track-builder apps/track-builder

# The API is this page's own /api (nginx.conf), wherever the page is served:
# nothing about the address is baked in.
ENV VITE_SERVER_URL=/api
RUN VITE_BUILDER_URL=/builder/ pnpm --filter @dont-fall/client exec vite build --outDir /site --emptyOutDir \
 && VITE_CLIENT_URL=/ pnpm --filter @dont-fall/track-builder exec vite build --base /builder/ --outDir /site/builder --emptyOutDir

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /site /usr/share/nginx/html
