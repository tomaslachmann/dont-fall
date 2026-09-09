# 04 — The Match runs several Rounds

**What to build:** A Match that runs its configured number of Rounds without passing through the
Lobby, carrying the results as it goes.

**Blocked by:** ticket 03 (nothing to carry until a `RoundResult` exists).

**Status:** done

## Why

This is the milestone. Today `MatchPhase` is `LOBBY | COUNTDOWN | RUNNING | ROUND_END | RESULTS`
(`MatchPhase.ts:10`) and `RESULTS` is terminal: it sits there until the host sends `returnToLobby`.
The machine has no notion that another Round might follow.

`matchRuntime.ts:109` holds `dnf` for the current Round and `matchLoop.ts:112` clears it on every
fresh `COUNTDOWN`. Round results must live somewhere with the opposite lifetime — cleared when a
*Match* starts, not when a Round does.

## What to change

- [x] The runtime gains Match length and the list of `RoundResult`s so far, both Match-scoped:
      cleared on a fresh Match, never on a fresh Round
- [x] A finished Round appends its `RoundResult` before the phase leaves `ROUND_END`
- [x] `RESULTS` stops being terminal. With Rounds remaining it advances into the next `COUNTDOWN`
      once the next Track has loaded; on the last Round it stays, as today, until `returnToLobby`
- [x] The results list rides the snapshot alongside `lobby` and `dnf` (`matchLoop.ts:216`). Score is
      **not** sent — it is `matchScore` over this list, computed by whoever needs it (ADR 0049)
- [x] `returnToLobby` becomes a Match-end action: valid in `RESULTS` on the final Round, refused
      otherwise with a readable reason, the way M5 ticket 07 refuses an unraceable Track

## Done when

- [x] Server tests over a real socket: a three-Round Match runs start to finish on one connection,
      never entering `LOBBY`, and the snapshot carries three results at the end
- [x] The phase machine's own tests cover "Rounds remain" and "this was the last one" as separate
      transitions out of `RESULTS`
- [x] A Match started fresh from the Lobby has an empty results list — a second Match does not
      inherit the first one's Score
- [ ] **Live:** two browsers play a three-Round Match end to end without either client reloading or
      returning to the Lobby, and both agree on the results at every Standings — **deferred to
      end-of-milestone live verification, by the user's own call**

## Watch out for

**The Tick epoch.** M5 ticket 08 found that a Track pick restarted the Tick epoch under clients that
had already seeded their prediction tick (ADR 0027), freezing everyone in the Lobby. Loading Round
two's Track is that same operation, now on a hot path that every Match takes. Whatever M5 ticket 08
did to fix it is what Round loading must go through — do not re-derive it.

**`ROUND_END_MS` was sized for a Round that ends a session.** Between Rounds it is a beat before the
Standings, not a wind-down. Re-feel it; it may want to be shorter.

**Eliminated Characters are still in the world** (M5 ticket 04, ADR 0042) with colliders disabled.
Starting the next Round has to bring them back properly — this is exactly where M5 ticket 08 found
ghost Characters, and it is now three times as likely to happen.

**Phase transitions are the server's** (ADR 0040). Clients render `phase`; nothing here may let a
client decide a Round is over.

## Implementation notes

`advanceMatchPhase` gained two new `MatchPhaseInputs`: `roundsRemaining` (a level, `roundResults.length
< matchLength`, default `false` so every pre-M7 call site/test keeps today's single-Round behaviour)
and `nextRoundReady` (a level gate on `RESULTS → COUNTDOWN`, default `false`). `returnToLobbyRequested`
now only fires `RESULTS → LOBBY` once `!roundsRemaining`.

`MatchRuntime` gained `matchLength` (defaults to `DEFAULT_MATCH_LENGTH` = 3, overridable via a new
test-only `matchLengthOverride` config knob — the same shape `timeLimitMsOverride` already is),
`roundResults: RoundResult[]` (cleared in `resetToFreshLobby`, never elsewhere), `nextRoundReady`, and
a new `startNextRound(track)` method mirroring `resetToFreshLobby` exactly (build-before-dispose, keep
the Tick epoch via `syncTick`) but landing in `COUNTDOWN` instead of `LOBBY` — the same "world rebuilt,
not just phase reset" fix M5 ticket 08 needed, now needed a second time on a hot path every Match
takes.

`matchLoop.ts`: the moment `ROUND_END → RESULTS` fires, `buildRoundResult` is called against the live
simulation snapshot (identical timing to the existing `qualifySurvivors` call, for the same reason —
Score has to see this Round's own Survivor Qualification) and pushed onto `rt.roundResults`. If Rounds
remain, `nextRoundReady` is reset false and flipped true by a fire-and-forget async IIFE — nothing to
actually await yet (the next Round replays the same Track), but the shape is there for ticket 05's real
`await fetchTrack` to drop into without reshaping the surrounding code. `RESULTS → COUNTDOWN` calls
`rt.startNextRound`; `lobby.ts`'s `returnToLobby` handler refuses silently (same idiom `start` already
uses) while Rounds remain.

Six pre-existing single-Round-flow tests broke against the new default-3-Round-Match behavior (they
returned to the Lobby, or asserted a frozen clock, right after one Round) — pinned to
`matchLengthOverride: 1` rather than rewritten, since they're still testing exactly what they always
tested. Two new tests added for this ticket's own "Done when": a full 3-Round Match over one real
socket connection with no Lobby re-entry, and a second Match's `roundResults` starting empty after a
`returnToLobby`.

## Code review findings and fixes

`/code-review high` (intricate phase-machine/netcode logic, per CLAUDE.md) — 8 findings, all fixed
(this ticket's diff had by then absorbed ticket 05's real draw mechanism, so some fixes below are
described in terms of the combined state):

- **Fixed — the "Back to Lobby" button on the pre-existing `ResultsScreen` was unconditionally
  rendered and wired**, but the server now silently refuses `returnToLobby` while Rounds remain
  (default Match length 3) — a host who finished Round 1 saw a normal, enabled button that did
  nothing when clicked, no error, no feedback. `ResultsScreen` gained an optional `roundsRemaining`
  prop (default `false`, so every pre-M7 render is unchanged); while `true` it shows "More Rounds to
  play — advancing automatically…" instead of the button, for host and guest alike. `game/index.ts`'s
  `onResults` callback gained a second `roundsRemaining` argument computed from
  `message.roundResults.length < message.lobby.matchLength`, threaded through `GameCanvas.tsx`. New
  tests in `ResultsScreen.test.tsx`. The real fix (a proper Standings Screen) is ticket 06's; this is
  the minimal "stop lying to the player" fix so the milestone doesn't ship that gap in between.
- **Fixed — no population gate on the automatic `RESULTS → COUNTDOWN`**, unlike the Lobby's own
  manual `start` (`sockets.size >= playersToStart`). A Player dropping between Rounds (to 1, not to
  0 — `connectedPlayers === 0` already forces `LOBBY`) used to carry whoever was left into a fresh
  Round alone. New `MatchRuntime.canContinueMatch()` = `roundsRemaining() && sockets.size >=
  playersToStart`, used everywhere the old `roundsRemaining()` fed a continue-the-Match decision
  (the `advanceMatchPhase` input, the round-push gate, `returnToLobby`'s refusal) — `false` makes
  RESULTS terminal exactly as it is with no Rounds left, so an under-population Match can't deadlock
  waiting for Players ADR 0024's still-unbuilt reconnection will never bring back this Match.
- **Fixed — `startNextRound`/`resetToFreshLobby` duplicated the same five-line world-rebuild
  sequence**, risking the ticket's own warned-about ghost-Character drift if a future fix landed on
  one copy and not the other. Extracted a private `rebuildSimulation(track)`; both public methods now
  call it and only add what's specific to their own destination phase.
- **Fixed — `PredictionLoop.step`'s pre-clamp silently discarded a legitimate sub-tick remainder at
  the `MAX_STEPS_PER_FRAME` boundary**, unlike the `advanceFixed` it replaced (ticket 01) — a real
  ~5-6fps sustained frame rate, not just a catastrophic stall, lost banked render-interpolation time
  on every frame that grazed the clamp, and `advanceFixed.test.ts`'s own coverage of the correct
  behavior was deleted along with the dead code. Fixed by removing the pre-clamp and restoring
  `advanceFixed`'s original two-stage discipline (bound the loop by `steps`, then `% TICK_MS` only the
  leftover once a whole tick or more is still banked) — this is a genuine, if narrow, correctness fix
  to pre-existing (not ticket-01-introduced) production code, verified by direct calculation before
  fixing. Two new regression tests in `predictionLoop.test.ts`.
- **Fixed — the "ties share, next skips" ranking arithmetic was hand-rolled three times** (`Score.ts`,
  `Results.ts`, `Qualification.ts`) with two different shapes. Extracted `rankWithTies` (new
  `packages/shared/src/match/ranking.ts`) — an already-ordered list plus a caller-supplied "are these
  two tied" predicate — and switched `Results.ts`'s `buildResults` and `Score.ts`'s `buildRoundResult`
  onto it; both existing test suites pass unchanged (byte-for-byte behavior preserved).
  `qualificationPlacement` (`Qualification.ts`) is deliberately left alone — it answers a structurally
  different question (one Character's rank, counted directly over an *unordered* collection, no
  materialized sorted list at all) that forcing through the same shape would cost real allocation for
  no shared code.
- **Fixed — `rt.roundResults.length < rt.matchLength` ("are Rounds remaining") was written inline at
  three call sites** with no shared accessor. New `MatchRuntime.roundsRemaining()`
  (superseded at its continue-the-Match call sites by `canContinueMatch()` above, but still the one
  place `matchLength`-only remaining-ness is asked).
- **Fixed — the `nextRoundReady` placeholder wrapped two synchronous assignments in a pointless async
  IIFE** that netted to a no-op within the same tick, misrepresenting a real async gap that didn't
  exist yet. Superseded by ticket 05's real mechanism: `buildMatchStructure()` (drawing every unpicked
  Round slot) is kicked off once, the instant `start` fires, and the per-Round IIFE now `await`s the
  real `matchStructurePromise` it left running.
- **Fixed — `rt.simulation.snapshot()` was called twice in the same tick** (once for
  `buildRoundResult`, again later for the outgoing snapshot) with nothing mutating the simulation in
  between. Stashed the first snapshot in a tick-scoped `precomputedState` and reused it, safe because
  the two call sites are on mutually-exclusive `nextMatch.phase` branches.

Two review candidates were investigated and refuted, not fixed: a claimed `nextRoundReady` reset gap
turned out to be structurally inert, and a claimed `advanceMatchPhase` precedence gap turned out to be
an explicitly-tested, intentional design choice.

Re-verified after fixes: full monorepo typecheck and `pnpm -r test` green (607 shared, 93 server, 239
client, 88 track-builder, 67 track-service, 21 ui). The server suite showed one transient timeout on
one of four consecutive full runs (unrelated test, real WebSocket/HTTP timers) — consistent with the
pre-existing "real-timer/real-network flakiness under load" already documented in ticket 01's own
implementation notes, not reproduced on three subsequent clean runs.
