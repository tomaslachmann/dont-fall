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
