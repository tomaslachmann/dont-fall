# 21 — Difficulty as style above a fixed safety layer

**Design:**
- ADR 0130 point 5 and the amendment's point 7;
- ticket 08, whose profile ranges this revisits;
- 07m's finding that EASY's timing error of 4–10 Ticks, 1.5–3.7 m of an 11 u/s wall, makes some
  obstacles unsolvable rather than harder.

**Status:** planned. **Last,** after 15–20. It is a design change, so settle the numbers with the user
before building.

## What becomes style (profile fields, ranges per level)

- aggression;
- route choice at forks;
- Dash use;
- patience: how long a Bot waits for a best window, or its turn in 18;
- gap acceptance;
- willingness to yield in 19 and 20;
- occasional legal cutting in (18's compliance);
- bounded execution noise.

## What does not vary

The edge and committed-safety invariants, the reservation's safety, and hazard perception beyond a
floor. Decide with the user how much of `lookAheadTicks` and `timingErrorTicks` stays as a difficulty
dial, and with what floor so that every obstacle stays solvable.

## Targets

Whole-Race finishes ordered HARD ≥ NORMAL ≥ EASY, with EASY finishing on every Race, from 0 / 0 / 4
today. Own Falls stay ordered the same way. Step-offs are 0 at every level.
