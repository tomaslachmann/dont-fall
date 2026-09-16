# 04 — Pushed and hit by a moving Segment

**What to build:** a moving Segment that moves into a Character pushes it out
and delivers an Impact from the closing speed at the contact point, through the
existing Stagger/Ragdoll thresholds.

**Blocked by:** 02.

**Status:** done (2026-09-14) — tests; the live check is the user's.

## What to change

- [x] Post-step contact test capsule × moving Segment colliders; push-out queued
      into the next sweep
- [x] Closing speed from `motionPointVelocity` along the normal, net of the
      Character's velocity → Impact (cause `Obstacle`); the ridden body is exempt
- [x] Tests: a slow Slide pushes without a state change; a fast Swing tip
      knocks down; a hub-near hit on a Spin staggers or pushes where the rim knocks down
- [ ] Live check (the user's): a hammer swing ragdolls a player in two browsers

## Notes

- Impact scale and lift are Bump's (`MOVING_SEGMENT_IMPACT_SCALE`/`_LIFT_RATIO`
  in tuning): one rule for "something ran into you" (ADR 0061).
- Open: a Character crushed between a Moving Segment and a wall is pushed into
  the wall every tick and never resolved — no crush rule yet. Candidates: a
  knockdown when the push is blocked, or ignoring the Segment for a tick.
- Amended by ticket 10 / ADR 0065: pressed from above while grounded, the push
  (and the closing speed) runs sideways along the body's sweep instead of into
  the floor — the `trap_trapball` "held underneath" bug.
