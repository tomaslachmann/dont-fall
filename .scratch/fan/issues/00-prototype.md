# 00 — Prototype: the new fan, its air, and floating

**What to build:** finish the throwaway prototype in `apps/client/prototypes/fan-airflow/` so the
user can pick (a) what the air over a fan looks like, (b) how BLIP moves while an updraft holds it
up, and (c) how fast the rotor spins. Everything after this folder's tickets is blocked on those
picks.

**Blocked by:** —

**Status:** built (2026-09-16) — typechecks and bundles with Vite; never run here (no live checks,
and no WebGL, so no shader has been compiled). **The look is the user's to judge.**

## Decided by the user (2026-09-16)

- `fan.glb` (ADR 0075's Meshy drop) is replaced by **`assets/fan_lower_poly.glb`**.
- The rotor is cut out of that file's one fused mesh at **radius 0.64**: a triangle whose centroid
  lies within 0.64 of the Y axis and above y 0.30 is rotor, the rest is housing. Chosen over 0.62,
  0.66 and 0.70 by comparing offline renders. The file's leftover Blender `Cube` is dropped.
- The rotor **spins**.
- Today's air (translucent box + white rings, `airColumns.ts`) **looks terrible and does not fit
  the game**. It gets replaced.
- Floating in an updraft **must not look static**. BLIP freezes today because `JumpSequences`
  only moves forward. The loop needs more of the jump's segments, and the user asked for it to be
  thought through carefully.

## What the prototype offers

- [x] Fan: `fan_lower_poly.glb` seated on y = 0, rotor split at 0.64/0.30 and spun about its own
      centre (the rotor's own triangles give the axis, not the whole mesh's bounds).
- [x] Air, in the column's own frame (+Y = the Volume's force, so a sideways wind is a rotation):
      - **cartoon swooshes**: tapered ribbons spiralling up, curling out at the top, pure vertex
        shader;
      - **cartoon puffs**: the Environment's own low-poly cloud puffs, small, popping out of the
        mouth, coloured from the active preset;
      - both together (default);
      - **smoke wisps, made louder** (the user asked, 2026-09-16, before deciding): four shells
        instead of three, denser noise, the thick of the smoke shaded toward the active preset's
        cloud colours, an optional hard-banded cartoon look, and every knob on a slider;
      - today's rings and round one's haze/dust for comparison.
- [x] Float: `TODAY` (the game's path), `HOLD` (round one: apex hold + partial `Struggle_Air`),
      `LOOP` (below). Both new modes share a latch and an optional procedural layer.
- [x] Studying aids: STAY (never drift out), slow motion, per-layer sliders (signed where a limb
      could turn the wrong way), "copy settings".
- [x] Air picked (2026-09-16): **cartoon — swooshes + puffs**, at the prototype's default
      numbers (the user sent the variant name and no settings). The numbers now live in
      `packages/shared/src/track/AirColumn.ts`. Built in ticket 03.
- [x] Float picked (2026-09-16): **LOOP**, at the prototype's default numbers. Built in ticket 04.
- [x] Rotor speed picked (2026-09-16): **14 rad/s**. Built in ticket 02.
- [x] "A new Flying state?" answered (2026-09-16): the user agrees with ticket 04's proposal.
      There is no new `CharacterMotionState`, and Floating is drawn only.

## LOOP, the proposed answer to "not static"

Riding the fan def's field (force 40 against gravity −22, capped at 10 u/s), a Character does not
float still. It bobs over the column's top: pushed up to +10, it overshoots about 2.3 units, falls
back in at about −10, and is caught again, roughly every 2 s. `LOOP` makes the playhead a function
of vertical speed while floating, both ways:

- up at `JUMP_VELOCITY` → the rise side of the loop;
- zero → the apex;
- down → the fall side.

This is `jumpSequence.ts`'s own entry-point mapping (on the authored parabola, clip time is linear
in vertical speed), no longer forward-only. The bob then walks the playhead back and forth across
`Jump_Rise → Jump_Apex → Jump_Fall` on its own, paced by the physics, not a timer. A slow "breathe"
keeps it moving if the speed ever holds steady. The push-off still plays first, and leaving the
updraft hands the playhead back to today's forward-only pacing toward the brace.

**Floating is latched.** Entering an updraft while airborne starts it. It ends on landing, or after
`releaseMs` outside every updraft, which is longer than the bob's overshoot above the column.
Without the latch the pose drops out and back in on every bob. Round one's hybrid had exactly
that bug.
