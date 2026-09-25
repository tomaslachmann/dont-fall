# 07k — A Character wedged in a moving body's seam is stuck forever

**What to fix:** a simulation defect found by the bots, which a human Player hits the same way. A
Character carried by a turntable onto the seam between two of its pieces sinks into the groove. It ends
up inside the moving body and is never grounded or pushed out again. It is never counted as fallen
either, so it stays stuck for the rest of the Round. This is a `simulation/character/` ticket, not a bot
one.

**Found by:** 07h round 2 (`07h-moving-rows-with-a-crowd.md`, "As built (Round 2)", the `bot-9` trace).
**Runs in parallel with 07j**, which touches no simulation file.

**Wall clock: 75 minutes. Model: Fable.** Stop rule: 3 failed attempts at one fix, then record the
numbers and the diagnosis and stop.

## The trace (07h round 2, measured)

`transfers:T1:normal` (`packages/shared/src/bot/transfers.test.ts`, Track T1: two turntables), `bot-9`:

- Ticks 429–495: the Bot stands still on the second turntable (`waitToAlight`) while the spin carries it.
- Tick 496: the spin carries it onto a seam between two of the disc's **eight pieces**. It sinks 0.18 m
  into the groove, still grounded, with `platformUnder` null.
- By Tick 500 it sits at y 4.45, 0.4 m under the deck top and inside the outline. It is **never grounded
  again**. Its position stays frozen to the centimetre for the remaining 1300 Ticks, while `velocity.y`
  grows without bound: −3.5 at Tick 500, **−843 at Tick 1645**.
- A horizontal push plus a jump in either direction changed only its horizontal velocity. The capsule
  controller cannot move it, and a jump cannot fire because it is not on the ground.

Two things are wrong, and each wants its own answer:
1. **Why the seam swallows a capsule.** It could be a gap or step between the pieces' colliders, the
   ride carry (chord versus arc over still Ticks), or the kinematic character controller's
   depenetration against a moving kinematic body. Find which one before fixing anything.
2. **Why a wedged Character never recovers or falls.** Nothing pushes it out, and `velocity.y` piles up
   with no effect. At minimum a Character must never stay stuck: either it is freed, or its growing
   gravity must stop accumulating unseen.

## How

1. Reproduce it deterministically: run the `transfers` T1 NORMAL case alone and confirm bot-9's trace.
   Then build a minimal repro with no Bot: one Character placed where bot-9 was at Tick 496, on the same
   Track at the same Tick. Make that repro the regression test (`simulation/character/*.test.ts` or next
   to `CharacterController`).
2. Read the turntable's collider layout at the seam: the piece outlines, any gap, the heights.
3. Fix it where it starts, in `simulation/character/` (`MovementController` / `Capsule`) or in how the
   ride carry is applied. It must stay deterministic and shared by client and server (ADR 0003/0005),
   and the Character stays a kinematic capsule (ADR 0006). If the fix changes feel or replication, stop
   and write it down rather than build it: that needs an ADR and the user.
4. Any new constant goes in `packages/shared/src/tuning/` (`character.ts` or `movement.ts`).

## File ownership

- Yours: `packages/shared/src/simulation/character/*`, `CharacterController.ts`, and a new test beside
  them.
- Not yours: anything in `packages/shared/src/bot/`, where 07j is reading, and `tuning/bots.ts`.

## Rules

- NEVER commit, stash, reset or revert.
- Run only the suites your change touches, plus the regression set below.
- Known reds that are not yours: the 14 standing failures in `RapierSimulation.test.ts` (compare their
  count before and after, and they must stay 14), the trapHold D/S wall-clock asserts, and
  `difficulty.test.ts`.

## Regression set

- `simulation/character/*.test.ts` and `simulation/**/*.test.ts`: the same failures as before, no new ones;
- `packages/shared/src/track/baseRace.test.ts` and the authored Tracks' walks (`walkTrack`);
- `packages/shared/src/bot/transfers.test.ts` (T1 NORMAL stranded should now be 0);
- `packages/shared/src/bot/neverStepsOff.test.ts -t "every Motion stopped"`;
- typecheck `packages/shared`, `apps/server` and `apps/client`.

## Done when

The minimal repro is a test that is red before the fix and green after, T1 NORMAL has 0 stranded, and
the regression set holds. Write "As built" below with the numbers first, the cause as found, and whether
an ADR is needed.

## As built (2026-09-25, Fable, ~75 min; numbers first)

| Run | before | after |
|---|---|---|
| `transfers:T1:normal` | 11 passed + **1 stranded** (bot-9) | **12 passed, 0 stranded** (falls: contact 1, Bump 1) |
| bot-9's capsule centre, Ticks 490 → 491 → 493 → 494+ | 4.860 → 4.678 → 4.452 → frozen, `velocity.y` −2.7, −3.5 … −843 | never leaves 4.86 (the jumper case below) |
| minimal repro, rider's lowest y (standing 4.85), jumper from 6.6 / 6.7 | **4.397 / 4.299**, never grounded again, `velocity.y` −24 / −31 after 40 Ticks | > 4.75, grounded, `velocity.y` −2 (ground-stick), 0 Falls |
| a Character reconciled to the frozen pose (0.679, 4.452, −35.649) | stays there | grounded at y 4.86 after **one** Tick, rides on > 1 m in the next 30 |
| `RapierSimulation.test.ts` | 14 red | **14 red** |

Every run was beside 07j's suites on four cores, so the one wall-clock number (T1's `thinkUsPerBotTick`
91 > 40) is inflated and is the only red on T1 — read it alone before trusting it, as 07h says.

### The cause: not the seam. A Character landing on the rider's head

Reproduced Tick for Tick (the section harness is deterministic per seed), then bot-9's capsule controller
was wrapped so every `computeColliderMovement` printed its input, result and contacts. The disc's eight
pieces are convex hulls (a quarter circle is one; a quarter curve is **48 wedge hulls**, each 0.03–0.15 m
wide, with a 0.1 m bevel top and bottom) — but a Character alone, placed at bot-9's Tick-486 pose, rides
straight across the same spot with its positions matching the replay's to the millimetre. What the replay
had that the minimal did not was **`bot-2`, 1.5 m up, coming down from a jump onto bot-9**.

- Tick 490 → 491: the **Ride sweep** (`MovementController.sweepRide`) asked for (−0.083, 0, −0.019) and got
  (−0.049, **−0.182**, −0.195): one toi-0 contact, **bot-2**, normal (0.734, −0.678, −0.026). Rapier's
  controller slides along what it meets; the underside of a capsule slopes *down*, and this sweep runs with
  the carrier's colliders ignored (ADR 0061: riding never collides with what it rides) and snap-to-ground
  off, so nothing stopped it entering the disc. `grounded` still read true that Tick.
- Tick 492 → 493: the same again, normal (0.829, −0.529, 0.181), **−0.225**. Now 0.4 m in.
- From 494: the own sweep from inside reports 20 toi-0 contacts, all wedge side faces (±(0.957, 0,
  0.289)) — a capsule 0.4 m deep in a ring of 0.1 m wedges is nearer their sides than their tops —
  `computedGrounded` false, movement (0, 0, 0). Rapier's controller never depenetrates; the pushes
  `resolveMovingSegmentContacts` queued (sideways, from opposite wedges) were swept and blocked the same
  way. Gravity integrated into `velocity.y` with nothing to spend it on.

So the two questions have two answers: **(1)** the seam swallows nothing — the Ride's carry sweep slid the
rider down another Character's underside into its own carrier, which that sweep cannot see; **(2)** a
capsule inside a solid is never grounded and never moved, because the controller only sweeps and every
sweep from inside meets a face at no distance.

### The fix (two changes, `simulation/character/`, one constant)

1. **A Ride never takes a rider below its carrier** — `sweepRide`: `carried.y = max(carried.y,
   min(displacement.y, 0))`. Below a rider there is only its carrier, so no obstacle can legitimately take it
   lower than the carry does; a wall still blocks sideways, a ceiling still blocks a rise, and a descending
   deck still descends. The horizontal part of the slide (being shoved by whoever landed on you) is kept.
2. **A capsule inside a solid is lifted out onto it** — the backstop for every other way in (a
   correction, a squeeze). `sweepCapsule` notes a sweep that asked to go down and made less than a tenth of
   it (`blockedBelow`); `settleOnGround`, in the mirror of its ADR 0084 branch, then asks
   `SurfaceController.solidExitAbove()` — a point query at the capsule's lowest point (is it inside a
   non-sensor, non-Character collider?) and a hollow ray straight up from it for where that solid ends
   (with `solid` off Rapier reports the boundary a ray *leaves* through; its normal is no help, Rapier turns
   it to face the ray either way — measured (0, −1, 0) on the exit through the deck's top, which is why
   the first cut of this filtered the very hit it wanted). The capsule is lifted by that plus the skin
   width, marked grounded and lands there; the fall speed it piled up is zeroed first, since it was never a
   fall (on ice it would have counted as a hard landing). Reach: `WEDGE_LIFT_MAX` (`tuning/character.ts`,
   the capsule's own height, 1.7 m).

Neither changes feel or replication: both act only in a state that was already a bug (a Ride sliding below
its floor; a capsule inside a solid), add no replicated field, and run identically in prediction and on the
server. The regression test (`simulation/character/rideWedge.test.ts`) is the ticket's own ask: T1, the
same disc, a rider at bot-9's Tick-486 pose and a jumper at bot-2's, for the two start heights that wedge
it (6.6, 6.7; found by a search — 6.4 and 6.5 shove it down 0.29 / 0.13 and it recovers, ≥ 6.8 misses),
plus a Character reconciled straight into bot-9's frozen pose at Tick 494 (`reconcileCharacter` then
`syncTick`, the client's own order). Both were red on the numbers above before the fix.

### Regression set

- `simulation/**/*.test.ts`: 479 passed, 16 failed — the 14 in `RapierSimulation.test.ts` (unchanged), plus
  two **pre-existing** reds not on the ticket's list, proven by running both suites against `e518afb7`'s
  versions of the three changed files: `MovingSegment.test.ts:589` (the trapball test's precondition
  `depthInBall() > 0.3` reads −0.97 at Tick 0, before any Tick — `addCharacter`'s seat-clearing lifts the
  Character out of the ball) and `GrabHolds.test.ts:200` (a grabber's predicted x 0.11 off the server's,
  0.05 allowed).
- `baseRace`, `spinCycle`, `slipStream`, `survivalArenas` (the walks): 24 / 24.
- `transfers.test.ts -t "T1 at normal"`: 12 passed, **0 stranded**; red only on think ≤ 40 µs under load.
- `neverStepsOff -t "every Motion stopped"`: 9 / 9.
- typecheck: `apps/server` and `apps/client` clean; `packages/shared` has one pre-existing error in the
  tracked `simulation/bombHome.scratch.test.ts` (an unused `RAPIER` import), untouched here.

### ADR

None needed. Worth a line in ADR 0061's "As built" that the carry sweep's result is floored at the carry
itself, and why — not done here, since the ADR's text was not this ticket's to change.

### Files

`simulation/character/MovementController.ts` (`sweepRide` floor, `blockedBelow`, the lift in
`settleOnGround`), `simulation/character/SurfaceController.ts` (`solidExitAbove`), `tuning/character.ts`
(`WEDGE_LIFT_MAX`), `simulation/character/rideWedge.test.ts` (new), this ticket. No bot file and no
`tuning/bots.ts` line was touched. Note: the main session's `d197d71e` (07j's "As built") swept these four
working-tree files into its commit while this ticket was mid-run, so they are in HEAD under 07j's message.
