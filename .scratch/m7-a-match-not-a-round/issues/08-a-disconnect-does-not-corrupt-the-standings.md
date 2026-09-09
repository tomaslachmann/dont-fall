# 08 — A disconnect does not corrupt the standings

**What to build:** A Player who drops keeps their Score in the standings and scores zero for the
Rounds they miss.

**Blocked by:** ticket 04.

**Status:** implemented — verification pending (socket tests written but unrunnable in this sandbox; live needs browsers; see notes)

## Why

Today a mid-Round drop becomes a DNF entry (M4 ticket 05) and `rt.dnf` is wiped at the next
`COUNTDOWN` (`matchLoop.ts:112`). Over one Round that is right: leaving is not a result to rank
among the ones that were played out. Over a three-Round Match it means a Player who dropped in Round
two vanishes from the standings, and the Score they earned in Round one goes with them.

This ticket is deliberately narrow. It is **not** reconnection — `reclaim` exists in the protocol
(ADR 0024) and the server still "does not act on it yet". The point here is only that scoring does
not have to be redesigned when reconnection is eventually built.

## What to change

- [x] A Player who drops mid-Match stays in the standings with the Score they had
- [x] They score zero for Rounds they miss, which falls out of ticket 03's `matchScore` on its own:
      a Player absent from a `RoundResult` scores nothing for it. Verify that, do not re-implement it
- [ ] The Standings marks them as gone rather than showing a live Player on zero — needs ticket
      06's Screen, which does not exist yet; the data contract it should render is settled below
- [x] A Player who connects mid-Match spectates until it ends and plays from the next Match. They
      are in the Lobby's list, not in the Round
- [x] `reclaim` is not touched

## Done when

- [ ] Server tests: a three-Round Match where one of three Players drops after Round one — the final
      standings list all three, and the dropper's total is exactly their Round-one Score
      (test written in `matchServer.test.ts`; UNRUN — this sandbox denies even loopback
      `listen`, so no socket test in the repo can run here)
- [ ] The remaining Rounds are scored over the field that actually played them, not the field that
      started (the percentile form depends on this — ticket 03; asserted in the same test)
- [ ] Everyone dropping mid-Match ends the Match rather than leaving a server looping over an empty
      field — M5 ticket 08 already found ghost Characters left behind exactly this way
      (test written; UNRUN, same cause)
- [ ] **Live:** three clients, one closed mid-Match, and the other two see it stay in the standings
      with its earned Score for the rest of the Match (needs browsers + sockets; also blocked
      here — and the Standings surface it would show on is ticket 06, still blocked itself)

## Implementation notes

No new wire state and no scoring change — the mechanics tickets 03/04 built already
park a dropper's Score correctly (union of `roundResults`, Match-scoped, attached to
neither `dnf` nor `eliminated`): a mid-Round drop is DNF-filtered out of that Round's
rows, a between-Rounds drop simply never appears in later ones, and `matchScore`
pays zero for the absence either way. What this ticket actually changed:

- **Spectator join** (`matchServer.ts`, `matchRuntime.ts`): M4 ticket 05's mid-Match
  refusal is gone. A connection landing outside LOBBY/COUNTDOWN while someone is
  here is welcomed into the Lobby's list (`lobbyPlayers`, sockets, inputs) but
  seated by no simulation (`rt.spectators`, skipped by `buildSimulationFor` — so
  `startNextRound` keeps them out of every remaining Round too). `resetToFreshLobby`
  clears the set *before* rebuilding, so the next Match seats them. Leaving as a
  spectator records no DNF and touches no body. COUNTDOWN joins still seat (the
  Round hasn't begun racing). Client: a joiner with no server Character follows
  the field through ticket 07's camera/banner path (`isMatchSpectator`), and the
  ELIMINATED banner is gated off them (they never played). Their local ghost
  still walks unseen at spawn — visible to nobody, reconciled into place next
  Match; noted, not fixed.
- **Host drop**: deliberately *finishes*. Phase transitions are the server's
  (ADR 0040) and need no host; `resolveHostId` recomputes, so the longest-waiting
  remainder owns `returnToLobby` at the final Results. No code change — pinned by
  the host-drop socket test instead.
- **All drop**: deliberately ends in a fresh Lobby via the existing
  `connectedPlayers === 0` path — no empty-field loop, and the `roundResults`
  wipe there stands as a Match boundary (nobody left to read them; without
  `reclaim` a returner is a new id anyway, so preserving would only leak stale
  totals into the next Match). Ticket 04's known-gap note in `resetToFreshLobby`
  is updated to say exactly this.
- **Population gates** (`canContinueMatch`, still `sockets.size`): spectators
  count as present. A lone racer plus a spectator still continues — no loop, no
  crash, just a thin Round — which beats re-deriving ticket 04's reviewed gate
  around a second notion of presence for a case the ticket never names.
- **Gone-marking contract for ticket 06**: gone ⟺ appears in some `RoundResult`'s
  rows AND is absent from `lobby.players` (covers between-Rounds drops and
  qualified-then-dropped alike; a mid-first-Round drop appears in no rows and
  correctly has no Score to park). In-Round marking already exists (`dnf` →
  "Left early").
- **Vacuous-rounds edge** (known, accepted): if only spectators remain mid-Match,
  Rounds run out with an empty field and end normally — no deadlock, and a lone
  spectator is host and can `returnToLobby`.
- **Verification actually run here**: shared 608 / client 269 / ui 21 /
  track-builder 88 green; new `matchRuntime.test.ts` (4 tests: seat-skip,
  next-Round exclusion, fresh-Lobby re-seat — no sockets needed) green; full
  monorepo typecheck green (covers the unrunnable socket tests too).
  `reclaim` untouched — verified by diff (`git diff` names no reclaim path).

## Watch out for

**Two ideas of "gone" already exist**: `dnf` (Round-scoped, cleared at every Countdown) and
`eliminated` (a marked Character left in the world, ADR 0042). Score needs a third lifetime —
Match-scoped — and it must not be attached to either of those or it will be cleared with them.

**The host can be the one who drops.** M4 ticket 07 made start host-gated and M5 ticket 08 found the
last-Player-drops case the hard way. A Match whose host leaves mid-way still has to finish or end
deliberately; decide which and write it down.

**Do not let this grow into reconnection.** If it starts needing session tokens, it has escaped its
scope — stop and give reconnection its own milestone.
