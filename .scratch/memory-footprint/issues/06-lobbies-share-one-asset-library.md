# 06 — Lobbies in the API read Assets from disk and share them

**What to build:** Match servers the API starts in-process (ADR 0054/0058) stop
fetching Assets over HTTP from their own process; they read the assets directory
and share one immutable per-id Asset cache across Lobbies. The standalone
`apps/server` keeps fetching over HTTP.

**Decided:** not yet — proposal (option D). Needs an ADR: it changes ADR 0050's
fetch-once-per-loader to once per API process.

**Blocked by:** 01 (per-id loading is the unit that gets shared).

**Status:** proposal

## How it behaves after

- Ten open Lobbies hold one copy of each Asset they use, not ten.
- A Lobby boots without a loopback download of its Assets.
- An art edit on disk is picked up by a new Lobby only after the cache entry is
  invalidated (mtime), never under a running Match: a running Match keeps the
  world it built.

## Checklist

- [ ] ADR (amends 0050 for in-process servers)
- [ ] Shared per-id cache with mtime invalidation, injected into `startServer`
- [ ] Tests: two Lobbies share one parsed Asset; a running Match never sees an edit
