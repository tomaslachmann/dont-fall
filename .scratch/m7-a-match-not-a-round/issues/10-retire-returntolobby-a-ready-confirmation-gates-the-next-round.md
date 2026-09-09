# 10 — Retire `returnToLobby`; a Ready confirmation gates the next Round

**What to build:** Protocol + server. Between Rounds, the advance to the next Round waits on every
*currently connected* Player confirming "ready for the next Round," with a timeout ceiling as an
AFK safety net — not the bare `nextRoundReady` timer ticket 04 shipped. At Match end, there is no
group action left on the server side at all: `ReturnToLobbyMessage`/`returnToLobby` is removed
outright.

**Blocked by:** nothing. Independent of ticket 09.

**Status:** server-side implemented — client plumbing lands with ticket 12 (same commit pass); live verification pending

## Why

ADR 0051 supersedes ADR 0049's "advances on its own once the next Track has loaded, not a button
someone has to press" line — that design was superseded verbally in an earlier session and never
written down, so ticket 04/06 built to the stale text. Confirmed live: with `nextRoundReady`
typically already true by the time a Round ends, the between-Round RESULTS phase lasts about one
server tick — indistinguishable from no Standings Screen at all.

## What to change

- [ ] `protocol.ts`: remove `ReturnToLobbyMessage` and the `returnToLobby` client message type
      entirely.
- [ ] `protocol.ts`: add a new RESULTS-phase-only client→server message (e.g. `StandingsReadyMessage
      { type: "standingsReady" }`) — any *connected* Player may send it, no host restriction, unlike
      every other Lobby/Match-structure message this project has built so far.
- [ ] `lobby.ts` (or wherever the handler lives): remove the `returnToLobby` handler and its
      host-only/RESULTS-only gate. Add the new handler: RESULTS-only, records this connection's own
      confirmation.
- [ ] `matchRuntime.ts`: a new Round-scoped (not Match-scoped) "who's confirmed this Round's
      Standings" set — same lifetime as `dnf`, cleared on every fresh COUNTDOWN, never carried
      across Rounds like `roundResults`/Score is. A Player who disconnects mid-Standings drops out
      of the set the instant they leave — recompute against `sockets`/`lobbyPlayers` live, never a
      snapshot of who was connected when RESULTS began.
- [ ] `tuning.ts`: a new constant for the timeout ceiling (propose `STANDINGS_READY_TIMEOUT_MS =
      10_000` — a starting number, not a final one; re-feel it live the way ticket 04's own
      `ROUND_END_MS` warning already asked of that constant).
- [ ] `MatchPhase.ts`: `MatchPhaseInputs` gains a resolved boolean (e.g. `standingsConfirmed`) —
      already computed by the caller as `everyoneConfirmed || timedOut`, the same "caller decides,
      this function only reads a level/edge" discipline `startRequested`/`allQualified`/
      `nextRoundReady` already follow. `RESULTS → COUNTDOWN` now requires `roundsRemaining &&
      nextRoundReady && standingsConfirmed`, not `nextRoundReady` alone.
- [ ] Match end (`!roundsRemaining`): RESULTS stays terminal server-side, exactly as today — nothing
      about "leaving" is a server transition any more. A Player leaving the final Standings for the
      Main Menu (ticket 12) is a plain client-side navigation/disconnect, the same shape `onExit`
      already has — no new protocol message needed for it.

## Done when

- [ ] `MatchPhase.test.ts`: `RESULTS → COUNTDOWN` waits for confirmation even once `nextRoundReady`
      is true; fires once every connected Player has confirmed; fires separately once the timeout
      elapses with nobody having confirmed. A Player disconnecting mid-RESULTS does not block the
      remaining Players' confirmation from completing it.
- [ ] Server tests: `ReturnToLobbyMessage`/`returnToLobby` is fully gone (grep the diff, not just
      the tests). The new Ready message is accepted from any connected Player and refused outside
      RESULTS.
- [ ] **Live:** a Match with Rounds remaining sits on Standings until every connected Player has
      clicked ready (or the timeout fires), then genuinely advances — visibly, not in one tick.

## Implementation notes

Server-side landed as designed: `standingsReady` replaces `returnToLobby` in `protocol.ts`;
`MatchPhase.ts`'s `RESULTS → COUNTDOWN` now reads `standingsConfirmed || (tick - phaseStartTick) >=
standingsReadyTimeoutMs`, both caller-computed levels (`allStandingsConfirmed()`,
`STANDINGS_READY_TIMEOUT_MS`); RESULTS at Match end is simply terminal now — no transition out of it
exists in the machine at all, matching "each Player leaves independently." `standingsReady` (the new
`Set<string>`) is Round-scoped exactly like `dnf`, cleared at the same two call sites in
`matchLoop.ts`. `allStandingsConfirmed()` reads live against `sockets`, not a roster snapshot, so a
mid-Standings disconnect can't block the rest — mirrors `canContinueMatch()`'s own discipline.

**Found and fixed during this pass, not scoped by the ticket originally:** a population drop below
`playersToStart` mid-Match (the case ticket 04's own code review wired through
`returnToLobbyRequested`) had no escape left once that message was retired outright — `roundsRemaining`
(fed from `canContinueMatch()`) goes false, so RESULTS→COUNTDOWN's gate never fires, and with
`connectedPlayers` still > 0 the `connectedPlayers === 0` branch doesn't fire either: the Match would
sit in RESULTS forever with a field too small to race and no way out but every remaining Player also
disconnecting. Confirmed this is the *intended* new shape (nobody gets a "return to Lobby" button
anymore, under-population or not — they leave, same as any Match end) rather than a bug, and covered
it with a dedicated server test.

**Test rewrite, not just new tests:** every existing socket test that drove a multi-Round Match
(`matchServer.test.ts`) previously relied on the old bare-timer auto-advance and would otherwise hang
on the new confirmation gate. Added a shared `autoConfirmStandings(...sockets)` helper (stands in for
each Player's own Ready click on every RESULTS snapshot) and wired it into every such test. The whole
"Results, and going again (M4 ticket 08)" describe block — built entirely around the retired
`returnToLobby` — is replaced by "Standings gates the next Round on confirmation (M7 ticket 10, ADR
0051)"; three other tests ("a Match runs several Rounds," "a disconnect does not corrupt the
standings" ×2) had their `returnToLobby`-dependent tails trimmed or rewritten to the new
disconnect/reconnect equivalent where the thing under test was still real.

**Verification actually run here:** `packages/shared`/`apps/server` typecheck clean; `packages/shared`
full suite green (652 tests, including 12 new `MatchPhase` tests for the confirmation gate);
`matchRuntime.test.ts` green (5 tests, no sockets). The rewritten/new `matchServer.test.ts` socket
tests are **written, not run** — this sandbox denies loopback `listen` for any socket test in this
repo (same limitation ticket 08 hit) — needs a real run to verify.

## Watch out for

**This is intricate phase-machine logic — `/code-review high` per CLAUDE.md, not medium.**

**Do not conflate this with the Lobby's own `allReady` gate.** Same *discipline* (a level, recomputed
live, never blocked by someone who's left), different lifetime and different phase — reuse the
idea, not the field.

**The timeout is a safety net, not the expected path.** Nobody is meant to tab out mid-Match; don't
design the UI around the timeout being normal (that's ticket 12's concern, not this one's, but the
gate itself should read the same way — waiting-for-confirmation is the story, the timeout is what
stops a Match from actually deadlocking).
