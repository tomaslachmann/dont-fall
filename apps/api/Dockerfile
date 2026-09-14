# Build context must be the REPO ROOT, not this directory — the api is a
# pnpm workspace package and depends on packages/shared and apps/server:
#   docker build -f apps/api/Dockerfile -t dont-fall-api .
FROM node:22-slim

# better-sqlite3 is a native module and needs a compiler at install time.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile --filter @dont-fall/api...

COPY packages/shared packages/shared
COPY apps/server apps/server
COPY apps/api apps/api
COPY assets assets

ENV TRACK_DB_PATH=/data/track-service.sqlite
ENV TRACK_ASSETS_DIR=/app/assets
EXPOSE 8081
VOLUME ["/data"]

CMD ["pnpm", "--filter", "@dont-fall/api", "start"]
