# 16 — Track discovery / browsing

**What to build:** Richer `track-service` listing metadata (ratings, play counts, author, best
time, filter categories) beyond today's flat `{id, name}` listing, needed by `Discover.tsx`.

**Blocked by:** nothing — independent of the account tickets (11–14) and can be picked up
whenever, per ADR 0052.

**Status:** landed — the lighter cut is built, wired, and tested (vitest + typecheck).
Remaining: live verification with real running processes (a Round's play
landing in TRENDING, the Lobby inline pick over a real socket), which this
sandbox can't do (it denies binding sockets).

## Decided scope (ADR 0052)

- **Browsing + category filters only** (e.g. Trending/Survival/Race/New-shaped tabs). Explicitly
  **not** in scope: ratings, author-name display, "best time." A lighter cut of `Discover.tsx`,
  not the full mock — those three specifically depend on identity/social data this ticket doesn't
  need.
- Play counts (to power "Trending"-style sorting) are in scope and don't need real accounts —
  an anonymous per-Track counter is enough.

## Why

Real Track listing today is a flat `{id, name}[]` (`TrackListing`, per
`docs/research/codebase-audit-m5.md` §3.3), consumed only by the host's Track picker inside the
Lobby (`LobbyScreen.tsx:59-72`). No matchmaking or browse endpoint exists in `apps/server/src`.
`Discover.tsx` assumes ratings, play counts, "best time," author name, and filter tabs
(Trending/Survival/Race/New) — a materially richer model than `track-service` provides today.

See `docs/research/test-components-design-screens-gap-analysis.md`, "Backend/domain gaps"
(Matchmaking/discovery entry) and screen row 1f.

## What changed

- **Shared:** `TrackListing` gains `plays` + `hasFinishZone` (a derived
  raceability fact, not a Round-type tag — ADR 0041 still holds); new pure
  `trackHasFinishZone(track, modules)`, lenient on unknown Modules like
  `countCheckpoints` (a label, not a load).
- **API:** new `track_plays` table (keyed by `track_id`, so counts survive
  republishes; separate from `tracks` so Revisions stay immutable per ADR
  0032); `GET /tracks` rows carry both new fields (`hasFinishZone`
  computed on read against `PUBLISH_MODULES`, never stored, so the listing
  can't disagree with the server); new
  `POST /internal/tracks/:id/played` behind the service token (404 naming
  an unknown id, same message as `fetchTrack`).
- **Server:** new fire-and-forget `TrackPlayRecorder` (betting's notifier
  posture: logs, never throws, never blocks the Round), injected on
  `MatchRuntime`, reported on both COUNTDOWN entries — Round 1 from an
  explicit `LOBBY → COUNTDOWN` branch, later Rounds after the draw lands
  (deliberately *not* next to betting's open, where `fetched` still points
  at the previous Round's Track).
- **Client:** `Discover.tsx` rewritten on the real listing (no author, no
  rating, no best time, per scope); tabs are TRENDING (plays desc),
  SURVIVAL (whole catalogue A–Z — every Track supports Survival),
  RACE (raceable only), NEW (recency); featured band plays the hottest
  Track. New `/discover` route (a card boots Practice on that Track);
  Main Menu DISCOVER pill + 404 BROWSE DISCOVER link to it. The Lobby's
  BROWSE TRACKS renders the same catalogue **inline** — navigating to a
  route would unmount the Lobby and drop the socket the pick travels over
  (M2 does not reconnect); a card selects straight into Round 1.

## Done when

- [x] `GET /tracks` rows carry `plays` + `hasFinishZone`; no ratings, no author display, no best time anywhere
- [x] Every Round start counts one anonymous play on its Track (Round 1 and later Rounds)
- [x] `/discover` browses the real catalogue with working Trending/Survival/Race/New tabs
- [x] A Track is pickable from the Lobby through the Discover catalogue
- [x] Play counts and raceability covered by tests at every layer (shared/API/server-notifier/client)
- [ ] Live-verified with real running processes (blocked on a sandbox that allows sockets)

## Watch out

- Don't start implementation from this ticket's current state. If picked up before accounts
  exist, explicitly drop author-name display rather than faking it against `DEFAULT_AUTHOR_ID`.
