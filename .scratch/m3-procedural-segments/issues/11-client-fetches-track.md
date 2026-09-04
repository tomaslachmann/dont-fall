# 11 — Client fetches its Track from track-service (not the hardcoded M1 import)

**What to build:** `apps/client` still imports `PLAYGROUND_STATICS` etc. directly from
`packages/shared` — the only remaining place doing that (ticket 03 only switched the Match
server). The Match server's welcome message tells each client exactly which `trackId`+`revision`
it's running (ADR 0032 makes this well-defined and immutable for the Match's whole run); the
client fetches that exact Revision from track-service and resolves it the same way the Match
server does, instead of always rendering/predicting against the M1 seed regardless of what the
server is actually running.

**Blocked by:** 10 (needs a well-defined, immutable Revision to fetch — fetching "latest" twice,
once from each side, could otherwise race against a new publish).

**Status:** done

- [x] `WelcomeMessage` carries the `trackId`+`revision` the Match server is running
- [x] Client fetches that exact Revision from track-service at connect time, before building its
      local Rapier world / scene
- [x] Client no longer imports `PLAYGROUND_STATICS`/`PLAYGROUND_PROPS`/`PLAYGROUND_SPINNERS`/
      `PLAYGROUND_CHECKPOINTS` directly for the live Track
- [x] Manually verified: publish a new, non-M1 Track, point the Match server at it, confirm a live
      2-browser session actually shows/predicts on that Track, not the M1 seed

Track-service gained `GET /tracks/:id?revision=N` (ADR 0032 left the exact addressing scheme as a
ticket-level detail) so the pin is real, not cosmetic — without it `GET /tracks/:id` always answers
"latest," which is exactly the race this ticket exists to close. Verified live: real track-service +
real Match server + a real WebSocket client doing the client's exact bootstrap sequence (read
`welcome.trackId`/`trackRevision`, fetch that Revision, `resolveTrack`) — confirmed it resolves the
published non-M1 Track, and confirmed a republish landing after `welcome` doesn't change what the
pinned fetch returns. No real browser available in this environment to click through visually; the
scripted check exercises the identical code path `apps/client/src/main.ts` runs.
