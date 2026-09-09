# 02 — A Survival Round can be ranked

**What to build:** Record and replicate the Tick a Character was eliminated, so a Survival Round
produces a real order instead of a binary.

**Blocked by:** nothing.

**Status:** done

## Why

Scoring pays by placement (ADR 0049), so every Round must produce one. A Race does:
`buildResults` sorts Qualified by `finishTick` and the rest by Checkpoint progress.

A Survival Round does not. `eliminated` is a plain boolean (`RapierSimulation.ts:86`), every
survivor is handed the same `finishTick` when the Round ends
(`RapierSimulation.ts:766` — `if (!progress.eliminated && progress.finishTick === null)
progress.finishTick = tick;`), and the eliminated fall through to the progress tie-break. On the
arena Module — one flat platform, no Checkpoints (M5 ticket 06) — that orders nobody. Everyone who
fell shares one placement, whether they went off the edge in the first two seconds or survived to
the last.

"How long you lasted" is the whole content of a Survival Round, and it is the one thing the
simulation currently throws away.

## What to change

- [x] The Tick a Character was eliminated is recorded where `eliminated` is set today — the same
      place, so there is no second path that can disagree about whether someone is out
- [x] It rides the snapshot. It is per-Character Round state like `finishTick`, not derived
- [x] `buildResults` ranks the non-Qualified by it, **latest elimination first**, and falls back to
      Checkpoint progress where there is none (a Race, where nobody is eliminated at all)
- [x] Survivors keep sharing a placement — standard competition ranking, the convention
      `qualificationPlacement` and `buildResults` already use. Everyone still standing when a
      Survival Round ends genuinely tied

## Done when

- [x] Shared tests: a Survival Round with four Characters eliminated at four different Ticks ranks
      them in the reverse order they fell, and survivors share first place
- [x] A Race's ranking is byte-for-byte what it is today — no elimination Ticks exist there, so
      nothing may move
- [x] The existing M5 Results tests pass unchanged, or an expectation moves with a note saying why
- [ ] **Live:** a Survival Round in two browsers where one Player is shoved off early and the other
      late — the Results order matches what actually happened, not the order they connected —
      **deferred to one end-of-milestone live-verification pass, by the user's own call (no
      chromium-cli/Playwright in this sandbox, and docker-based track-service would need starting
      on the user's real machine for every ticket otherwise)**

## Watch out for

**The kill plane fires late.** `RapierSimulation.ts:1250` notes a Character can cross the kill plane
"one or more Ticks later" than the Fall that doomed it. The elimination Tick is therefore the Tick
the *elimination* was marked, not the Tick of the shove — which is the honest thing to rank by
anyway, and worth a comment so nobody later "fixes" it toward the shove.

**A mid-Round disconnect eliminates too** (M5 ticket 04, ADR 0042): the Character is marked and left
in the world. It gets an elimination Tick like any other, and ticket 08 decides what its Score does.

**`eliminated` is also read by `survivorTargetReached`** (`Qualification.ts:45`). Adding a Tick must
not change what counts as eliminated — only record when it happened.

## Implementation notes

Added `eliminatedTick: number | null` alongside `eliminated: boolean` everywhere it lives:
`CharacterProgress` (`RapierSimulation.ts`), `CharacterSnapshot`/`CharacterSnapshotFields`
(`SimState.ts`), and `ReconcileBase`. Set at the same two call sites `eliminated = true` already is
(`eliminateCharacter`, `detectFall`'s eliminating branch) via `this.tickCount`, and restored
unconditionally in `reconcileCharacter` right beside `eliminated`, same reasoning.

`buildResults`' `eliminatedRows` sort became a three-way comparator: `eliminatedTick` descending
(latest first), nulls sorted last, falling back to the existing `checkpointIndex` comparator when
both are null (a Race, or a tie) — byte-for-byte the old order for a Race, since nothing there ever
sets `eliminatedTick`.

Added new `Results.test.ts` cases (four-way elimination-tick ordering, survivor tie-sharing, Race
fallback) and 18 mechanical `eliminatedTick: <matching source>.eliminatedTick,` additions across
existing `RapierSimulation.test.ts`/`tickAddressedInput.integration.test.ts` `ReconcileBase` literals
(TypeScript's own missing-property errors found every one).

`/code-review medium` — no findings. Full monorepo typecheck and `pnpm -r test` green (577 shared
tests, up from 574).
