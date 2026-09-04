# Build context must be the REPO ROOT, not this directory — track-service is a
# pnpm workspace package and depends on packages/shared:
#   docker build -f apps/track-service/Dockerfile -t dont-fall-track-service .
FROM node:22-slim

# better-sqlite3 is a native module and needs a compiler at install time.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/track-service/package.json apps/track-service/package.json
RUN pnpm install --frozen-lockfile --filter @dont-fall/track-service...

COPY packages/shared packages/shared
COPY apps/track-service apps/track-service

ENV TRACK_DB_PATH=/data/track-service.sqlite
EXPOSE 8081
VOLUME ["/data"]

CMD ["pnpm", "--filter", "@dont-fall/track-service", "start"]
