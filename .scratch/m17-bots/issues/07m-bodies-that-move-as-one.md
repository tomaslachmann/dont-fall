# 07m — Bodies that move as one are one obstacle to a Bot

**The user's idea (2026-09-25):** when pieces are joined and move the same way, the Bot should read them
as one thing. Measured first, before anything was built.

**Status:** measured; not built yet.

## Measurement (the main session, 2026-09-25)

The test is a rigid-group check over every moving body. Two bodies are one group when body B's pose,
seen from body A's frame, stays the same at Ticks 0, 7, 23, 61, 150, 333 and 777 (four probe points,
tolerance 1 mm). The script is `groups.scratch.test.ts`, kept in the session scratchpad and not in the
repo. It is about 80 lines over `buildBotTrack`/`moving.poseAt`, so write it again if needed.

| Track | moving bodies | rigid groups | multi-body | Bot's platforms | Bot's crosses |
|---|---|---|---|---|---|
| base race | 32 | 29 | 1 | 8 | 0 |
| Spin Cycle | 142 | 54 | 11 | 11 | 2 |
| Slip Stream | 31 | 27 | 4 | 0 | 0 |

**Floors are already merged.** No rigid group's floors are split across two `Platform`s; `platformKey`
works. What is not merged, and where:

1. **Spin Cycle: a ball riding a carousel, in 9 groups.** Each group is 8 quarter pieces (floor) plus
   2–4 `kaykit_ball_*` (sweeper), on one spin:
   - three on Start → Cp 0: z −86, −103, −120, at spin 0.45 / −0.5 / 0.55;
   - five on Cp 0 → 1: z −257 … −297, at spin 0.7 → 1.18;
   - one before Cp 6: z −735.

   These are exactly **the two legs where all of Spin Cycle's Staggers are** (Start→Cp 0: Stagger
   17/40/38, Cp 0→1: 0/29/—; `07d`, the evening run). The Bot reads each ball as a world sweeper. Seen from
   the deck, a ball never moves: it is a wall on the platform. Seen from the lane, the balls are the rim
   of one rotating body, so waiting to board is a window in that body's rim.
   - Check against 07l's `swathsOn`: it takes riding sweepers "moving against the deck or spiked". A
     ball on its own carousel is neither, so it is likely not on the rider's list at all.
2. **Slip Stream Cp 1 → 2: four pairs of barriers** (`kaykit_barrier_4x1x2`, segments 109/110,
   112/113, 117/118, 120/121, at z −309 … −345). The two barriers in a pair slide together, 6.67 m
   either way, with a gap between them. Together they are **a moving doorway**. The Bot times each
   barrier on its own, at a fixed crossing line. This leg is Slip Stream's whole Stagger count (35 / 39
   / 71). A doorway that moves wants a Bot that walks with the gap. Waiting for a fixed line to be clear
   of both barriers may rarely or never happen.
3. **Base race Cp 4 → 5: four barriers** (segments 94/95/98/99, slide ±6 m), the same moving doorway.
   Stagger 4 at HARD.

## What to build

- `MovingWorld` gets **rigid groups** of any role: the test above, done once per world off the clock.
  Platforms and crosses stay what they are, and each becomes a special case of a group.
- **A sweeper riding its own deck** (1) is a still obstacle on the platform for a rider: the rider walks
  round it, and boarding counts it with the deck. For a Bot on the lane, the hold reads the group's
  sweeping parts as one body, so a boarding window is a window in the whole group.
- **A moving doorway** (2, 3): a sweeper group of two or more parts with a free gap between them. The
  hold plans a crossing *through the gap as it moves*: where the gap is at each Tick the Bot would be in
  the swath, instead of one fixed line clear of every part.
- Targets, on the section harness, two seeds, all three levels:
  - Slip Stream Cp 1→2: Stagger at HARD ≤ 10, passed ≥ 10, stranded 0.
  - Spin Cycle Start→Cp 0 and Cp 0→1: Stagger at HARD ≤ 10, stranded 0.
  - The rest of the regression set (07i's and 07l's): no worse.
