# 11 — The three-arm sweeper

**What to build:** `DF_sweeper_3_arms` as an Asset: a still tower and three
rotors, each its own moving Part turning at the rate its clip gives it.
ADR 0116 (Parts), 0124 (a Motion per Part).

**Blocked by:** 10

**Status:** done on tests (2026-09-23) — every visual and feel check is the user's

- [x] The source moves to `assets/DF_source/`; `pnpm convert:df sweeper_3arms`
      converts it: `tower` still, `low` / `mid` / `high` moving (roots
      `Low_Rotor`, `Mid_Rotor`, `High_Rotor`), `ScaleReference_170cm` dropped,
      the flush stripes/chevrons/rivets kept out of collision
- [x] The def (category `sweeper`) carries each rotor's Spin about +Y as read
      off its clip: Low −36°/s, Mid +72°/s, High −144°/s
- [x] Tests (shared): it resolves to one still body and three moving ones; each
      rotor's pose at Tick *n* matches its authored rate and direction; a
      `partMotions` retune of one arm leaves the other two alone

## Notes

- Measured from the export (2026-09-23): arms 5 m (the bumper reaches ~5.7 m),
  ⌀0.26, at y 0.89 / 1.51 / 2.13; tower ⌀1.44, top cap at 2.56. The Low arm is
  jumpable (apex ~1.3 m); the Mid one is not and sits just under
  `MOVING_SEGMENT_STAGGER_SPEED` at its tip; the High one passes over a 1.7 m
  bean's head. Whether that plays is 08's question.

## As built

- **The converter's Spin reading was wrong for this file.** It took a Spin to
  be one full turn per clip and dropped the sign, and these clips turn −1, +2 and
  −4 times. It now unwraps the angle sample by sample about a fixed axis. The same
  reading of the two-arm sweeper's clip gives exactly 72°/s (one turn in 5.00 s),
  not the 1.246 rad/s (5.04 s) in `SWEEPER_ROTOR_SPIN`: the old formula added one
  frame. The constant is untouched, since it is a feel number and the user's call.
- **Rested at 0° / 180° / 0°** (`PartRule.restAngle`): one arm is lopsided by
  design, and the pivot convention (`assetModules.test.ts`) centres X/Z on the
  bounds. Two opposite arms balance, which puts the tower's axis at the origin.
  The clips' own starts come back as each Spin's `startAngle` (15°, −40°, −100°),
  so Tick 0 looks the way the export does.
- **`noCollideMatching`** (`/Rivet|_Bolt_|_Chevron_/`) keeps 170 rivets out of
  collision: 12 solids on the tower and 8 per arm, instead of 86 and ~90.
  **`drop`** removes the scale reference.
- A repaired test: `asset.test.ts`'s parse check asserted once per triangle
  index, which is ~130k assertions on this file, and timed out under a full run.
  It now asserts the highest index per mesh.

