# 0044 — Input lock is one rule, inside the shared step, extending ADR 0040

M4 shipped two mechanisms that both decide "may this Character be driven this tick?", built a
ticket apart and never reconciled. Qualification's lock (M4 ticket 02, ADR 0039) lives **inside**
`RapierSimulation.tick`: a Qualified Character is fed idle input regardless of what it sent. The
Match-phase lock (ADR 0040) lived **outside** it, applied independently by the server's Match loop
(substituting idle input before calling `tick`) and by the client's own frame loop (substituting
idle input before calling the same prediction). Neither was wrong on its own — each is the shared
`phaseLocksInput`/`needsCorrection`-style pure function, so the two never drifted from each other —
but M5 adds a third reason a Character may be locked (an eliminated Character in Survival, ticket
04), and a fourth is plausible after that (frozen while terrain changes). Two mechanisms at two
layers becomes three or four at three or four layers unless this is fixed before the second one
lands.

## Decision

- `RapierSimulation.tick(inputs, phase = "RUNNING")` gains a second parameter. Inside the step, the
  Match-phase lock (`phaseLocksInput(phase)`) and the per-Character Qualification lock are ORed
  into one decision, in one place, right where the per-Character loop already reads `qualified`.
  A future Round type's own "who may move" rule — an eliminated Character in Survival — is one
  more term added to that same OR, not a new mechanism.
- The parameter defaults to `"RUNNING"` (unlocked) so every caller that only cares about physics —
  the great majority of this file's own tests, and every other direct `tick()` caller with no
  Match concept — is unaffected. Only the two real production callers (the server's Match loop,
  the client's own local prediction) ever pass a real phase.
- `replayLocalCharacter(id, inputs, phase = "RUNNING")` applies the caller's **current** phase to
  every replayed tick alike, rather than tracking phase per buffered input. The span replayed is
  only ever an RTT wide, so a phase transition landing mid-replay is a real but vanishingly rare
  edge — and `reconcile` already treats "now" as the single source of truth for tick alignment and
  Prop poses (`syncTick`, `syncPropsToSnapshot`) before this ticket, so this follows the same
  discipline rather than inventing per-tick phase history nothing else in the client tracks.
- Both the server's Match loop and the client's `PredictionLoop` now hand `tick()` the **real**
  input every tick, locked or not, and let the step decide. Neither pre-substitutes idle input
  before calling it. The client's own frame loop keeps one, clearly-scoped, separate check of
  `phaseLocksInput` for choosing an idle walk-animation stance while locked — cosmetic only, since
  the sim's own gate is what actually stops the Character; not a second enforcement mechanism.

This extends ADR 0040 rather than superseding it: phase locking input outside RUNNING is
unchanged, and the client still runs the identical rule as the server so both sides stop and start
driving the Character on the same Tick, which is what M4 ticket 04's synchronous start depends on.
What moves is *where* the rule is enforced — from two independent call sites into the one shared
step both sides already run.

## Considered options

- **Keep phase-lock external, only rename it** — rejected: leaves two mechanisms after this
  ticket and three after Survival adds elimination; does not answer the milestone's own framing
  ("one place to say 'not this Character, not this tick'").
- **A `Set<string>` of locked Character ids passed into `tick()`** — rejected for this ticket: the
  Match-phase lock is uniform across every connected Character, so a per-Character set is
  unneeded generality; Survival's own elimination lock (ticket 04) is a Character-collection
  concern (`progress`-shaped, like Qualification already is) that belongs inside the step next to
  Qualification's own per-Character check, not threaded in from outside.
- **Store a lock bit alongside each buffered input, replay it per-tick** — rejected: correct in
  principle, but adds a second field to every `PredictionLoop.inputBuffer` entry and every caller
  that reads it, to guard against an edge this codebase's existing reconcile-time simplifications
  (`syncTick`, `syncPropsToSnapshot`) already accept without it. Revisit if a real bug is ever
  traced to a phase transition landing mid-replay.

## Consequences

- `apps/server/src/match/matchLoop.ts` no longer imports `phaseLocksInput`/`IDLE_INPUTS` — it
  hands `RapierSimulation.tick` the raw applied input and the phase it just decided.
- `apps/client/src/net/predictionLoop.ts`'s `step`/`recordTick`/`reconcile` take an optional
  `phase` parameter, threaded from `apps/client/src/game/index.ts`'s own `phase`/`message.phase`.
- Every Round type from here on adds its own "who may move" term to the one OR inside
  `RapierSimulation.tick`, never a new external substitution site.
