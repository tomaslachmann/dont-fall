# 12 — Match server retries its startup Track fetch with backoff

**What to build:** The Match server fetches its Track exactly once, at startup (ticket 03) — it
never re-fetches while running, so an already-running Match is unaffected by track-service going
down afterward. The real gap is startup ordering: if track-service is still coming up (e.g. in
Docker, where container start order isn't instant), the Match server's one-shot fetch fails and it
crashes immediately. Add bounded retry-with-backoff around the startup fetch instead.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] `fetchTrack` retries on failure with backoff, up to a bounded total wait (e.g. ~30s)
- [ ] A clear log line on each retry attempt and a clear final error (naming ADR 0028) if every
      attempt fails — still fails loudly, just not on the very first transient miss
- [ ] Manually verified: start the Match server before track-service and confirm it waits and
      recovers once track-service comes up, instead of crashing outright
