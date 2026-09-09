# 01 — Retire the duplicate fixed-step loop

**What to build:** One implementation of the fixed-step timing semantics instead of two.

**Blocked by:** nothing. First, deliberately — `docs/architecture-review.md` §6 puts it first
because everything after it would otherwise rest on two truths.

**Status:** done

## Why

`docs/architecture-review.md` finding 4. `packages/shared/src/timing/advanceFixed.ts:50–81`
implements a fixed-step accumulator — an `EPSILON_MS` guard against float drift, a
`MAX_STEPS_PER_FRAME` clamp against the spiral of death when a backgrounded tab wakes up.
`apps/client/src/net/predictionLoop.ts:163–165` implements the same thing again, with its own
`EPSILON_MS` at line 27 whose comment says it "mirrors `advanceFixed`'s own guard".

Two implementations of one semantics will drift: a fix in one does not reach the other, and the
simulation then behaves differently depending on which path a frame took. `advanceFixed` and its
`FixedSimulation` contract have no production caller at all — `game/index.ts:54` and `:329` only
mention them in comments, and the only thing that runs them is `advanceFixed.test.ts`. Dead generic
code in `shared` also advertises an API production does not use.

## What to change

Binary, per the review — no third "compatible" variant:

- **(A)** Generalise `advanceFixed` until `PredictionLoop` (and ideally the main loop in
  `game/index.ts`) genuinely calls it, or
- **(B)** delete `advanceFixed.ts`, `FixedSimulation.ts` and their tests from `shared`, leaving the
  single implementation in the client.

- [x] Pick one and say why in the commit message
- [x] Either way, `EPSILON_MS` ends up with exactly one definition — the review suggests `tuning.ts`,
      next to `TICK_MS` and `MAX_STEPS_PER_FRAME`, which both branches already share
- [x] `roundClock.ts` is not touched

The review recommends **(B)** until a second production consumer proves itself: less code, one owner
of the semantics. Take that unless building it changes your mind.

## Done when

- [x] There is one accumulator loop and one epsilon in the repo
- [x] Full suite green in `packages/shared`, `apps/client`, `apps/server`
- [x] If (B): `FixedSimulation`'s in-memory fake path is checked before deleting anything — ADR 0009
      exists so the simulation can be tested without WASM, and the review flags this explicitly

## Watch out for

**ADR 0004 is not in scope.** The fixed 30 Hz step and render-side interpolation do not change; this
is about how many places implement them.

**Do not widen prediction while you are in here.** ADR 0016 and 0022 draw the line on what is
predicted; a consolidation refactor must not move it.

## Implementation notes

Took **(B)**: deleted `advanceFixed.ts`, `FixedSimulation.ts`, and `advanceFixed.test.ts` outright.
`grep` confirmed zero production callers (`game/index.ts` and `RapierSimulation.ts` only referenced
`FixedSimulation` in comments/an unused `implements` clause) and no other in-memory-fake consumer of
the `FixedSimulation` contract existed anywhere in the repo to preserve.

`FIXED_STEP_EPSILON_MS` added to `tuning.ts`; `predictionLoop.ts`'s own local `EPSILON_MS` copy
replaced with it. Also fixed a *third*, out-of-scope copy the code review turned up:
`apps/server/src/net/tickAddressedInput.integration.test.ts`'s own research-mode accumulator had its
own hand-rolled `EPSILON_MS = 1e-6`, now importing the shared constant too — small enough to fold in
without widening the ticket.

`/code-review medium` — no findings. Full monorepo typecheck and `pnpm -r test` green.
