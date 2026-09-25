# 07m — Bodies that move as one, and what each hook actually sees

**Where this comes from.** On 2026-09-25 the user suggested that joined pieces moving the same way
should be one thing to a Bot. The first version of this ticket was measurement plus a vague proposal.
The user called it misleading and not technical enough. This version is written from the code
(`sweeperHold.ts` `decide`, `deckRider.ts` `swathsOn`) and from the Track data dumped by
`buildBotTrack` (scripts `groups.scratch.test.ts` and `geo.scratch.test.ts` in the session scratchpad).

**Status:** measured, with two defects found in code; nothing built.

## Constants the mechanics below rest on

- `WALK_SPEED` 5.5 u/s, so 0.183 m per Tick. `CAPSULE_RADIUS` 0.35. `BOT_HOLD_MARGIN_M` 0.3, so
  `grow` = 0.65 m.
- Stagger closing speed: `MOVING_SEGMENT_STAGGER_SPEED` = 4 / 0.6 = **6.67 u/s**.
  - `BOT_HOLD_MIN_SPEED` = 3.33.
  - `BOT_HOLD_MIN_SPEED_WALKING` = max(0, 6.67 − walk) ≈ 1.2.
- Profiles (`BOT_LEVEL_SPREADS`):

  | Level | `lookAheadTicks` | `timingErrorTicks` |
  |---|---|---|
  | EASY | 0–5 | 4–10 |
  | NORMAL | 5–12 | 2–5 |
  | HARD | 12–24 | 0–2 |

## Rigid groups (measured)

The test: body B's pose seen from body A's frame is the same at Ticks 0, 7, 23, 61, 150, 333 and 777
(four probes, 1 mm).

| Track | bodies | groups | multi-body | Platforms | crosses |
|---|---|---|---|---|---|
| base race | 32 | 29 | 1 | 8 | 0 |
| Spin Cycle | 142 | 54 | 11 | 11 | 2 |
| Slip Stream | 31 | 27 | 4 | 0 | 0 |

- No group's floors are split across Platforms: `platformKey` holds.
- The two Spin Cycle crosses (28/29 and 33/34) are already `MovingWorld.crosses`.
- What is left is two kinds of group, and they are different problems.

## A. A ball riding its carousel — nothing in the Bot sees it (Spin Cycle, 9 groups)

**The geometry:**

| | Start → Cp 0 (segments 44–55, 57–68, 70–81) | Cp 0 → 1 (segments 127–180) |
|---|---|---|
| deck | 8 quarter pieces, hull reach **10.6 m**, y 4 | 8 quarter pieces, hull reach **5.41 m**, y 2 |
| spin | 0.45 / −0.5 / 0.55 rad/s, a turn in 419 / 377 / 343 Ticks | 0.70 / −0.82 / 0.94 / −1.06 / 1.18 rad/s, a turn in 269 … 160 Ticks |
| balls | **3**, box 2 × 2 × 2 m, at r = 6, 120° apart | **2**, box 1.4 × 1.4 × 1.4 m, at r = 3.71, 180° apart |
| ball world speed | 2.7 / 3.0 / 3.3 u/s | 2.6 → 4.4 u/s |
| the ball's annulus (± half-box + grow) | r 4.35 – 7.65 | r 2.36 – **5.06** on a 5.41 deck: the rim band **is** the balls' annulus |
| still floor beside | a 3 m wide lane (x −1.5 … 1.5) | none: five discs in a row, all transfers |

**What the code does with a ball (read, not guessed):**

1. **Aboard, and while boarding or transferring, `SweeperHold` does not run.** `hold()`'s first line is
   `if (steering.committed === true) return steering`, and every `DeckRider` Steering is committed (07l
   traced this).
2. **`DeckRider.swathsOn` drops the ball** (`deckRider.ts:253–256`):
   - it keeps a riding sweeper only when `|v_body − v_deck| ≥ BOT_HOLD_MIN_SPEED_WALKING` (≈ 1.2) or
     when it is spiked;
   - a ball on its own carousel has a relative velocity of **0**, so it is "scenery to the walk";
   - so the waiting spot (`outOfSwaths`), the walk across the deck (`swathAcross`) and `transferScore`'s
     landing-occupancy check all ignore it.
3. **The deck hull is a hull of the floor pieces only.** The balls stand inside it, so the deck, as the
   rider reads it, has no obstacle anywhere on it.

**What follows:**

- **Seen from the deck, a ball is a static box.** A rider walking into it closes at most at walk speed
  5.5, which is under 6.67: it is blocked, not Staggered. The loss here is a path that is not there.
- **A landing is where it hurts.** A Bot jumping disc to disc arrives with the take-off disc's rim
  velocity (Cp 0 → 1: 3.8 → 6.4 u/s at r 5.41).
  - The next disc counter-rotates (the signs alternate). The ball's velocity at the landing point is
    2.6–4.4 u/s.
  - `transferAim` / `transferScore` do not know the ball is there. On Cp 0 → 1 the whole rim band is the
    ball annulus.
  - So a landing inside the box, or a skid into it, closes at up to ~6.4 + 4.4 ≈ 10.8 u/s, well past
    6.67.
- **Boarding from the 3 m lane** (Start → Cp 0) is the same: a jump onto a disc whose ball is passing
  the landing point.

**To prove it before building (a stop rule, not a formality):**
- On the section harness, Spin Cycle Start→Cp 0 and Cp 0→1, HARD, seed 0, log every Stagger's Impact
  source (segment index) and the Bot's `DeckRider` phase (waiting / boarding / aboard / transfer /
  landing).
- The hypothesis holds if the ball segments (53–55, 66–68, 79–81, 135/136, 146/147, 157/158, 168/169,
  179/180) cause most of the Staggers, during `landing` or boarding.
- If they do not, stop and record what does.

**What to build (after the proof):**
- `MovingWorld`: a rigid-group partition, computed once per world off the clock (the probe test above,
  exact for bodies each driven by one periodic Motion; `strays` already classifies these).
  `Platform` gets `aboard: MovingBody[]`: the group's non-floor members.
- `DeckRider`: a co-moving member is a **static blocker in the platform frame**. Its hitboxes are taken
  into the frame once, as oriented boxes grown by `CAPSULE_RADIUS + BOT_RIDE_SWATH_MARGIN_M`. They are
  used by:
  - the waiting spot, the same as `outOfSwaths` but against boxes;
  - the walk across, a visibility path round at most four boxes: the deck frame is static, so this is
    an ordinary polygon detour and needs no timing;
  - `transferScore` and the boarding landing: refuse a landing Tick whose landing point, plus the skid
    07l already models, lies in a box.

  `swathsOn` stays for sweepers that move against their deck (07l).
- Targets: Spin Cycle Start→Cp 0 and Cp 0→1, HARD, two seeds: Stagger ≤ 10, stranded 0, passed no
  worse. NORMAL and EASY no worse.

## B. Two sliding walls in series — grouping is not what is missing (Slip Stream Cp 1→2, base race Cp 4→5)

**Correction of the first version.** These pairs are **not** a doorway with a gap to walk through.

- **Slip Stream:** 109/110, 112/113, 117/118, 120/121.
  - Each pair is two `kaykit_barrier_4x1x2` at scale 1.5 (box 6.08 × 1.7 × 3.2 m), **6 m apart
    along the lane (z)**. They slide in step across the lane, x = +5 ↔ −5, so each wall reaches
    x ±8.04.
  - One cycle takes 102 Ticks (period 3.4 s, a 0.4 s pause at each end, easeInOut). The average speed
    is ~7.7 u/s and the peak about **11 u/s**.
  - The lane is x −5.5 … 5.5.
- **Base race:** 94/95/98/99 are the same thing at scale 1.2 (4.86 × 1.36 m, ±3.6 m, 3.2 s).
- The strip between the two walls of a pair (6 − 1.7 = 4.3 m, 3 m after `grow`) is never entered by
  either wall. It is a safe place to stand between them.

**`decide` already tests every body that is near** at the Tick the Bot reaches each corridor sample. Two
walls moving in step add nothing it does not already test, and a group of them gives the hold no new
information. Three things in the numbers do matter:

1. **Defect in `inSwath` for slides.**
   - Samples past the look are checked only while `through` holds, and `through` is
     `inSwath(p)`: a disc of radius `body.radius + grow` = 3.16 + 0.65 = **3.81 m** round the body's
     *current* position.
   - For a spinner about its own origin that disc is the swath. For a slide it is not: the swath is the
     strip the wall sweeps, x −8.04 … 8.04 by 3 m.
   - A wall standing at x +5 while the path crosses at x −3 is 8 m away, outside the disc, so the part of
     the crossing past the Bot's look is **not checked at all**.
   - A crossing of one wall's strip is 3.0 m, which is 16 Ticks of walk. By level:

     | Level | Look | Covers | Result |
     |---|---|---|---|
     | NORMAL | 5–12 Ticks | 0.9–2.2 m | commits into a strip it has half checked |
     | EASY | 0–5 Ticks | at most 0.9 m | commits into a strip it has not checked |
     | HARD | 12–24 Ticks | 2.2–4.4 m | mostly covered |

   - At 11 u/s the wall crosses the lane's 11 m in about 30 Ticks.
   - **Fix:** a swept region per body in `MovingWorld`, computed once off the clock (for a single
     periodic Motion, the union of its hitboxes over one sampled cycle, stored as a hull), with
     `inSwath` asking that region instead of the disc. This is what 07i's comment "a swath it has
     noticed is checked all the way through" already claims, and for slides it is not true.
2. **Timing error against wall speed.** At ~11 u/s, one Tick is 0.37 m of wall travel.
   - EASY's 4–10 Ticks are 1.5–3.7 m, as much as the wall's half-width plus `grow` (3.69).
   - NORMAL's 2–5 Ticks are 0.7–1.8 m.
   - EASY cannot time these walls by construction. Whether that is the intended EASY is a design
     question for the user, not a bug.
3. **Where a held Bot stands.** At a lane edge (x ±5.5) the wall rests for 0.4 s, reaching ±8.04, and
   covers the edge for about 40% of the cycle. The middle (x 0) is swept twice a cycle, briefly. Which
   spot the hold stands on is decided by where the corridor happens to be, not by the strip.

**To prove it:** the same Stagger log as A (Impact source, plus the hold's decision and `through`
state at the moment of commit), on Slip Stream Cp 1→2 at all three levels.
- Point 1 holds if the Staggers at NORMAL and EASY come from walls the Bot committed into with `through`
  false past its look.
- The fix is proven the way 07j proved its attribution: the same leg and seed, before and after.

## Order and ownership

- **A** and **B-1** touch different files. A is `movingWorld.ts` (the partition) plus `deckRider.ts`. B-1
  is `movingWorld.ts` (the swept region) plus `sweeperHold.ts` `inSwath`. They can run as two agents if
  the `movingWorld.ts` additions are kept additive.
- **B-2** (EASY's timing error on fast walls) is the user's call.

## The log (2026-09-25, the main session): both hypotheses above are mostly wrong

**How it was measured.** `staggerLog.scratch.test.ts` lives in the session scratchpad and is not in the
repo. It patches the prototypes of `RapierSimulation.resolveMovingSegmentContacts`,
`CharacterController.applyImpact`, `DeckRider.steer` and `SweeperHold.decide` for the length of the test.
For every Impact from a Moving Segment of magnitude ≥ `IMPACT_STAGGER_MIN` (4) on a `Controlled` or
`Sliding` Character, it records:
- the Segment with the greatest closing speed, and that closing speed;
- the Segment's own point speed at the contact (`vseg`) and the Character's own speed (`vbot`);
- the `DeckRider` state;
- the hold's last decisions;
- whether it ended in a Stagger Fall (joined to `playSection`'s `where`).

The runs were `playSection` for 120 s with 12 Bots, seed `holds:07m:<leg>:<level>:0`, on three legs:
Spin Cycle Start→Cp 0, Spin Cycle Cp 0→1 and Slip Stream Cp 1→2.

| leg | level | passed | Stagger Falls | the Segment behind most Staggers |
|---|---|---|---|---|
| Spin Cycle Start→Cp 0 | H / N / E | 3 / 2 / 1 | 12 / 16 / 13 | **seg 37** (86 / 86 / 40 impacts, 27 / 33 / 17 → a Fall), then seg 31 |
| Spin Cycle Cp 0→1 | H / N / E | 7 / 8 / 6 | 15 / 11 / 18 | **seg 119** (88 / 50 / 39, 40 / 17 / 12 → a Fall) |
| Slip Stream Cp 1→2 | H / N / E | 11 / 8 / 1 | 10 / 21 / 35 | **seg 97** (51 / 72 / 86, 6 / 15 / 16 → a Fall), then 103; the sliding walls follow |

**A (balls on carousels) is refuted.** A ball took part in 4 impacts over all nine runs, and 0 of them
led to a Fall.

**B-1 (disc swath for slides) is real but small.** An impact is marked "unchecked" when the wall stood
outside the disc at the Bot's last "go" and the point of impact lay past its look. That happened only
at **EASY** on Slip Stream: 19 impacts, which lie behind at most ~13 of its 35 Stagger Falls. HARD and
NORMAL had none.

**What actually Staggers them: one bar spinning about its middle, hit by a Bot that is moving.**

- **The bars:**

  | Segment | Asset | where | pivot on | speed |
  |---|---|---|---|---|
  | 31 | `kaykit_barrier_4x1x1` at scale 2, half-length 4.0 | Spin Cycle | lane centre | 1.2 rad/s |
  | 37 | scale 1.8, 3.6 | Spin Cycle | lane centre | 1.8 |
  | 119 | scale 1.6, 3.2 | Spin Cycle | the middle of a 7 m catwalk (x 5.5 … 12.5) | 1.9 |
  | 97 | scale 2, 4.0 | Slip Stream | the lane | 1.5 |
  | 103 | scale 2, 4.0 | Slip Stream | the lane | 1.7 |

- **The bar alone is below the Stagger speed.** Tip speed w·r is 4.8 (31), 6.5 (37), 6.1 (119),
  6.0 (97) and 6.8 (103, only right at the tip), against **6.67**. Over 697 spin-bar impacts, `vseg`
  ≥ 6.67 held in **6**, and **not one** had `vbot` < 0.5. Every one of these Staggers needs the Bot's
  own velocity: closing = (v_bar − v_bot)·n.
- **What the Bot was doing when hit** (the hold's last decision):

  | level | retreat | go | hold (standing, but `vbot` > 0.5, still moving) |
  |---|---|---|---|
  | HARD | **229 / 252** | 18 | 5 |
  | NORMAL | **184 / 248** | 41 | 23 |
  | EASY | 0 | 76 | **113** |

  The EASY "holds" still carry speed: a Bot walked up to its stop point and had not stopped yet.
- **So at HARD and NORMAL the retreat causes the Stagger it runs from.** In `decide`,
  `counts(body, at, here)` is asked with no walk, so it holds a body counting once its speed passes
  `BOT_HOLD_MIN_SPEED` = 6.67 / 2 = 3.33. The arm is then reported as a threat, and `retreat()` walks
  the Bot back toward the previous corner at up to 5.5 u/s, often into the arm's path, which lifts the
  closing speed over 6.67. Had the Bot stood still, it would have been pushed (`queuePush`) but not
  Staggered, since the arm alone never reaches 6.67 on these bars.
- Standing still is not always safe. It is not safe where a push carries a Bot off an edge (seg 119's
  catwalk is 7 m wide with the bar reaching 3.3 either way; the Falls there are Stagger 15 and Bump 13,
  and none is `pushed`), or near a body faster than 6.67: the sliding walls, whose `vseg` ≥ 6.67 in 45 of
  102 other impacts, of which 10 were Falls taken standing at EASY.

## What this points to

These are proposals for the user, and nothing is built.

1. **A retreat must not be faster into the arm than standing.** In `decide`'s "here will be occupied"
   test, run `counts` for the move the Bot would actually make: closing =
   (v_body − v_retreat)·n. Compare it with the closing speed while standing (v_body alone).
   - If standing does not Stagger (below 6.67), and the push cannot carry the Bot off the floor within
     the contact (the guard can vet that as it vets any move), **stand**.
   - Retreat only when standing would Stagger, and then in a direction chosen **away from the arm's
     velocity**, not back along the path.
2. **EASY's still-moving "hold":** brake as `stand()` does on ice (a push against its own velocity) on
   every floor while a sweeper is near, so a hold really is standing still by the time the arm arrives.
3. **B-1 (the slide's swept region)** is kept for EASY at a lower priority.
4. **A (rigid groups)** is not needed for the Staggers. It stays a correctness nicety for the rider (a
   ball is a real box on the deck) with no measured cost.

The targets are unchanged. The first number to watch is Stagger Falls on the three legs at HARD and
NORMAL, before and after 1, on the same seeds.
