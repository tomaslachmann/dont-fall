# 0028 — A separate always-on track-service is the single source of truth for Tracks; the Match server only ever fetches one by ID

M3 needs a Track (a linear sequence of Segments) ready before a Round starts, built one of two
ways: a human hand-places Modules in an in-game/dev-only visual builder tool, or an algorithm
picks/orders Modules at random. Both are decided to be **creation paths into the same store,
not two runtime code paths**: a randomly-assembled Track is generated and persisted by the
track-service exactly like a hand-built one — it's just a Track row whose author happened to be
an algorithm instead of a person. The (ephemeral, spun-up-per-Match, ADR 0002/0011) Match server
never holds Module data and never generates or randomizes anything itself; at Round start it
always does the same one thing — fetch a fully-resolved Track (by ID, or "give me any") from the
track-service — whether that Track was hand-built or randomly generated makes no difference to
it.

**Considered:** letting the Match server generate a random Track itself, locally, from a static
Module library baked into `packages/shared` — no network call needed to start a Round, no new
runtime dependency. Rejected: the user judged a single, uniform "Track" concept — one store, one
fetch path, no special-cased runtime generation living in a second place — as the cleaner
architecture, worth the trade-off below.

## Consequences

- The Match server gains a **hard runtime dependency on the track-service being up** to start any
  Round — a real departure from M2's "single manually-started process, no orchestration" spirit
  (ADR 0002/0011), accepted deliberately here, not overlooked. Failure-mode handling (track-service
  unreachable at Round start) is not designed here — a ticket-level concern when this is built.
- The builder tool (visual, dev-only, standalone from the live game client, local single-player
  playtest only — no multiplayer, no auth) is a client of the track-service's save/load API, the
  same as the Match server's fetch is; neither generates or stores Track data on its own.
- `packages/shared` still owns Module *definitions* (geometry/colliders/tuning, unchanged authoring
  model — "authored once," code-level work); only the *assembled Track* (an ordered list of
  `{moduleId, position, rotation}` placements) lives in the track-service's database, never Module
  content itself.
