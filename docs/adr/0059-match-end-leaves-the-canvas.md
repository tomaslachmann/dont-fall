# 0059 — Match end leaves the canvas: persisted results, a fetched page, a server that closes itself

Until now a finished Match stayed inside `<GameCanvas>`: terminal RESULTS
rendered an overlay over the still-mounted game, and the match server kept
ticking (interval, Rapier world, sockets) until its Lobby emptied plus the
5-minute reaper grace. There was no backend match history to fetch — the
rewards claim trusted client-reported Rounds and re-minted on every refresh
(both limitations documented in `rewards.service.ts`, never fixed).

## Decision

- **The server persists each Match once, at its terminal RESULTS**
  (`PersistedMatchResult`: `roundResults` + nicknames + total falls). The save
  goes server → API over HTTP with the service token, the betting notifier's
  own posture — but load-bearing, not fire-and-forget: `matchOver` is only
  raised once the row lands, and a failed save retries on later ticks.
  Score stays derived (`matchScore`/`matchWinner` over the saved Rounds),
  never stored.
- **`matchOver: { matchId } | null` rides the snapshot**, not a one-shot
  message — the same discipline as the rest of Match state (ADR 0040/0057):
  a client that attached late reads the current value via `sync` instead of
  missing an event. `null` until the save lands, including a terminal RESULTS
  whose save is still in flight.
- **The client navigates to `/match/:matchId` on `matchOver`**, which
  unmounts the canvas (game, physics, socket) behind the navigation. The page
  fetches `GET /matches/:id` — a refresh shows the same Match instead of
  losing it. `?me=` names whose page it is (cosmetic: the "you" line and the
  claim rows); without it, or for an id that never raced, the page still
  shows the podium and the table, just no personal line and no COLLECT.
- **A finished server closes itself**: everyone left → close on the next
  tick; stragglers still connected past `MATCH_OVER_CLOSE_GRACE_MS` → close
  anyway. Leaving a finished Match never reopens a Lobby around it (the
  empty-mid-Match reset stays, so an abandoned Lobby remains reusable). The
  existing reaper needs no changes — an unreachable server is untracked
  within one poll.
- **The rewards claim names its `matchId` and is idempotent per
  `(account, match)`**: a replay returns the stored numbers, never a second
  credit. Unknown match ids are refused.
- **The in-canvas end-of-Match UI is retired**: `StandingsScreen` is deleted
  (superseding M9 ticket 05's "fold `MatchOver` into `StandingsScreen`" and
  M7 ticket 13's podium-into-Standings), and the client's per-Round history
  accumulator goes with it — the results page derives the same numbers from
  persisted rows. BetweenRounds stays an overlay; only Match end moved out.

## Consequences

- A finished Match costs nothing on either side: no ticking server, no
  mounted game. The only wait is the save itself (one localhost round-trip).
- The claim still trusts the client's own placement rows — match sockets
  don't know Accounts, so the server can't re-derive them. Bounding that
  lie to one claim per real Match (instead of one per refresh) is what this
  buys; true account linking stays its own milestone.
- `matchId` is still per-server-boot, not per-Match — a second completed
  Match on one server would collide on first-write-wins. Unreachable now
  (a finished server closes instead of hosting again), but a per-Match id
  belongs in the same milestone that ever reuses a server.
- A genuine full tie (same Score *and* same last-Round placement) shares the
  table placement, but the page's headline names the stable-first of the
  pair — the `MatchOver` design has no tie banner.
