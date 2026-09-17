# 0086 — The camera arm eases to its length

## Context

The third-person camera sits on a spring arm (`springArm.ts`). Every frame it
cast one ray from the Character toward the camera's wanted position, and put
the camera right at the hit (less a 0.2 skin) or at full distance. Around the
edge of a block that ray hits one frame and misses the next, so the camera
jumped between two distances frame to frame: it pumped in behind the Character
and back out (user report, 2026-09-17).

## Decision

**The probe decides how long the arm should be. The camera gets there over
time.** This is the usual engine answer (Unreal's camera lag, Unity's collision
smooth time). The user chose it over also moving the pivot.

- **Eased length, not an eased position.** Only the arm's length is smoothed,
  so turning the camera with the mouse stays immediate. The arm shortens with a
  0.06 s time constant (`CAMERA_ARM_IN_SECONDS`), so the camera spends only a
  frame or two behind a wall. It lets back out with a 0.4 s one
  (`CAMERA_ARM_OUT_SECONDS`), so a hit that flickers can't pump it.
- **A thick probe.** Five parallel rays instead of one: the arm, plus one
  `CAMERA_PROBE_RADIUS` (0.25) off it to the right, left, above and below. The
  nearest hit wins. The outer rays start inside the Character's capsule, which
  is wider, so none starts inside a wall.
- **Skin 0.2 → 0.3.**
- The pivot stays at the capsule centre. The first frame places the camera
  outright.

## Consequences

- A fast swing of the camera into a wall can show a frame or two from behind
  it before the arm catches up. `CAMERA_ARM_IN_SECONDS` is the knob.
- Four more raycasts a frame against the Track's meshes.
- Presentation only: nothing here touches the simulation (ADR 0009).
