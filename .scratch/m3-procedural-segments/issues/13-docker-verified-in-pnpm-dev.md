# 13 — Docker actually verified + folded into `pnpm dev`

**What to build:** The Dockerfile/`docker-compose.yml` for track-service were written and never
actually run — `docker compose up --build` needs to be run for real, any breakage fixed, and
`scripts/dev.sh` changed to start track-service via Docker (matching how it will actually run in
practice) instead of `pnpm --filter @dont-fall/track-service dev` directly.

**Blocked by:** None, but practically best done last (avoids re-verifying Docker after the schema
changes in tickets 09/10).

**Status:** ready-for-agent

- [ ] `docker compose up --build` actually succeeds; any Dockerfile/compose issues found are fixed
- [ ] `scripts/dev.sh` starts track-service via `docker compose up` (with the health-check wait
      unchanged) instead of `pnpm --filter @dont-fall/track-service dev`
- [ ] Manually verified: `pnpm dev` brings up a real Docker-hosted track-service, and the rest of
      the stack (Match server, client) works against it exactly as before
