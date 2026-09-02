# 13 — Docker actually verified + folded into `pnpm dev`

**What to build:** The Dockerfile/`docker-compose.yml` for track-service were written and never
actually run — `docker compose up --build` needs to be run for real, any breakage fixed, and
`scripts/dev.sh` changed to start track-service via Docker (matching how it will actually run in
practice) instead of `pnpm --filter @dont-fall/track-service dev` directly.

**Blocked by:** None, but practically best done last (avoids re-verifying Docker after the schema
changes in tickets 09/10).

**Status:** done

- [x] `docker compose up --build` actually succeeds; any Dockerfile/compose issues found are fixed
- [x] `scripts/dev.sh` starts track-service via `docker compose up` (with the health-check wait
      unchanged) instead of `pnpm --filter @dont-fall/track-service dev`
- [x] Manually verified: `pnpm dev` brings up a real Docker-hosted track-service, and the rest of
      the stack (Match server, client) works against it exactly as before

Ran `docker compose up --build` for real (this was never actually run before) — it built and
started clean, no Dockerfile/compose fixes needed even after tickets 09/10's schema changes
(revision/authorId/contentHash all round-tripped correctly through a real container + named
volume, including surviving a container restart). `scripts/dev.sh` now starts track-service via
`docker compose up --build` instead of `pnpm --filter @dont-fall/track-service dev`; its `cleanup`
trap runs `docker compose down` alongside the existing kill-by-port logic. Manually verified live:
`pnpm dev` end-to-end — Docker-hosted track-service reachable on 8081, the Match server fetched its
Track from it and served a real client connection over the wire (verified with a real WebSocket
client reading `welcome.trackId`/`trackRevision` and fetching that Revision back, ticket 11's exact
path), the Vite client dev server came up on 5173, and Ctrl+C cleanly stopped and removed the
container along with the other dev processes.
