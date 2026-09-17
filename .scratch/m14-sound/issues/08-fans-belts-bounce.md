# 08 — Fans, belts and bounce sheets

**What to build:** the machines on a Track hum while you are near them.
**ADR 0087.**

**Blocked by:** 02

**Status:** done on tests (2026-09-17). Hearing it in a game is the user's check.

## How it behaves after

- **Fans and updrafts** (Volumes that hold aloft, ADR 0075): a hum loop at the
  fan and an air rush through the column, gain following the Volume's force.
- **Conveyors** (ADR 0064): a rattle loop placed at the point of the belt
  nearest the listener, `playbackRate` following belt speed.
- **Bounce sheets** (ADR 0070): a rubbery thump on a press (`BouncePresses`),
  at the press, for any Character. *Built in 05* (its "Bounce" line), from
  `BouncePresses.landings()`.
- **Springs:** the pad's own squash (`SpringSquashes`) gets a creak on
  recovery. The launch's boing itself is 05's.
- All are loops under 02's nearest-k budget, silent past their `maxDistance`.

## What to change

- [x] Emitters built next to `buildAirColumns`, `buildConveyorStrips` and
      `buildBounceSheets`, reusing their placement (including under a Moving
      Segment's group)
- [x] Nearest-point-on-belt as a pure function with tests
- [x] Tests: each emitter's placement, gain following strength and speed, silent
      when far

## Notes

- Research §8, §9 (updraft columns).

## As built

- **`audio/machineSounds.ts`:**
  - **Pure functions:**
    - `nearestPointOnDeck` clamps the listener onto the deck rectangle, in its own plane.
    - `nearestPointInColumn` clamps it into the column's cylinder (`airColumnFrame`), along the
      flow.
    - `beltDeckAt(deck, carrier, tick)` carries a belt's rest deck by its Moving Segment's pose.
      It is the same frame change `seatOnDeck` makes.
    - `airLevel(force)` is |force| / 40 (`FAN_LOUD_FORCE`, the fan Asset's updraft), floor 0.3.
    - `beltRate(speed)` is 0.8 → 1.2 up to the `fast` preset.
  - **`MachineSounds`:** loops for the Stage's lifetime, placed each `updateMotion`.
    - A `segment.fan` hum at the entry face of each Volume that `holdsAloft` (where the fan is).
    - A `segment.air_rush` at each drawn column's point nearest the listener.
    - A `segment.belt` rattle at each belt's nearest point.
    - Silence past a slot's `maxDistance`, and the nearest-k choice, are 02's budget.
  - `machineSoundSlots(track)` decodes only what the Track has.
- **New slots, stand-ins sharing files** (the ADR 0087 amendment's rule):
  - `segment.air_rush` is the day wind on the effects bus, nearer (ref 2, max 18, k 2).
  - `segment.spring_settle` is the plank knock, quiet (0.35) and lifted (rate 1.4).
  - Both can be swapped by editing their row.
- **Springs:** `SpringSquashes.settled()` names the Springs whose squash ended this frame. The Stage
  plays the settle at that Spring's trigger. The boing is 05's.
- **Bounce sheets:** built in 05 (`BouncePresses.landings()`).
- **Stage:** built next to the column, strip and sheet builders, updated in `updateMotion`,
  disposed with the Stage. `stageSoundSlots` now also takes `volumes`, `conveyors` and
  `launchPads`.
- **Volumes on a Moving Segment:** `resolveTrack` places Volumes in world space and the columns are
  drawn still, so their sounds are still too.
- **Tests:** `machineSounds.test.ts`, and `springSquash.test.ts` for the settle.
