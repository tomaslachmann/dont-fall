# 07 — The Docker API runs as one plain node process

**What to build:** the API image builds to JavaScript at image build time and
runs `node dist/index.js` directly — no `pnpm --filter start` wrapper, no `tsx`
cli, no esbuild service at runtime.

**Decided:** not yet — proposal (option E).

**Status:** proposal

## Why

The container runs four processes for one service: pnpm (122 MB RSS), the tsx
cli (47 MB), the app (144 MB) and esbuild (24 MB)
(`docs/research/memory-bloat-investigation.md`). pnpm as PID 1 also doesn't
forward signals cleanly.

## How it behaves after

- One node process (plus nothing) in `docker top`; roughly 190 MB less in
  `docker stats` at idle; `docker compose stop` shuts down promptly.
- Same routes, same port range, same `/data` volume — nothing a client notices.
- Local dev (`pnpm dev`, `tsx watch`) is unchanged.

## Checklist

- [ ] Build step for `apps/api` + its workspace deps (`packages/shared`,
      `apps/server`) in the Dockerfile
- [ ] `CMD ["node", …]`, `init: true` or an equivalent for signals
- [ ] `docker compose up --build api`: `/health`, an asset, a Lobby start
