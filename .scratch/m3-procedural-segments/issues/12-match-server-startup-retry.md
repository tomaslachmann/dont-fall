# 12 — Match server retries its startup Track fetch with backoff

**What to build:** The Match server fetches its Track exactly once, at startup (ticket 03) — it
never re-fetches while running, so an already-running Match is unaffected by track-service going
down afterward. The real gap is startup ordering: if track-service is still coming up (e.g. in
Docker, where container start order isn't instant), the Match server's one-shot fetch fails and it
crashes immediately. Add bounded retry-with-backoff around the startup fetch instead.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] `fetchTrack` retries on failure with backoff, up to a bounded total wait (e.g. ~30s)
- [x] A clear log line on each retry attempt and a clear final error (naming ADR 0028) if every
      attempt fails — still fails loudly, just not on the very first transient miss
- [x] Manually verified: start the Match server before track-service and confirm it waits and
      recovers once track-service comes up, instead of crashing outright

Verified via `apps/server/src/index.test.ts` ("startup retry (ticket 12)"): a real `startServer()`
pointed at a URL nothing is listening on yet, `track-service` started ~150ms later, confirms the
server waits through the failed attempts and completes once it comes up; a second test confirms the
final error names ADR 0028 once the wait budget is exhausted. Test-only `trackFetchMaxWaitMs`/
`trackFetchRetryDelayMs` knobs on `StartServerConfig` keep the test fast without changing
production defaults (30s / 1s).
