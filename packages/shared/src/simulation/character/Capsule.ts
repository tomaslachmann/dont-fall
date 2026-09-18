import RAPIER from "@dimforge/rapier3d-compat";
import type { Vec3 } from "../../math/vec3.js";
import { CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS, CHARACTER_CONTROLLER_OFFSET, GROUND_SNAP_DISTANCE, WALL_NORMAL_MAX_Y } from "../../tuning/character.js";
import { CHARACTER_GROUPS } from "../collisionGroups.js";

/**
 * The kinematic capsule a Character is while upright (ADR 0006) — the one
 * body every part of `CharacterController` moves, probes from or switches
 * off. Shared, never owned by any one of them.
 */
export interface Capsule {
  readonly world: RAPIER.World;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  /** Rapier's own character controller: the sweep, snap-to-ground and the slope limits. */
  readonly controller: RAPIER.KinematicCharacterController;
}

/** Builds a Character's capsule at `spawn`, with the sweep configured the way ADR 0037 settled it. */
export const createCapsule = (world: RAPIER.World, spawn: Vec3): Capsule => {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z),
  );
  const collider = world.createCollider(
    RAPIER.ColliderDesc.capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS).setCollisionGroups(
      CHARACTER_GROUPS,
    ),
    body,
  );

  const controller = world.createCharacterController(CHARACTER_CONTROLLER_OFFSET);
  // Snap-to-ground ON (ticket 02, M3.6) — a spike measured it against the
  // M1-era edge-stalling/Dash-hitching symptoms it was originally disabled
  // for and reproduced neither; disabling it instead reliably reproduces
  // the ramp-skip bug it now fixes (see ticket 02's notes for both sets of
  // numbers). Autostep stays OFF: it hitches during fast movement (Dash),
  // and nothing about this ticket touches that rationale.
  controller.enableSnapToGround(GROUND_SNAP_DISTANCE);
  // Rapier's own climb/slide split is collapsed back to one coincident
  // value (ticket 03, M3.6, ADR 0037) — but at the *wall* angle
  // (`WALL_NORMAL_MAX_Y`), not its old 45°/45° default. That leaves Rapier
  // responsible for exactly one thing: "is this even standable ground at
  // all" (below it, `computedGrounded()` can be true; at/above it, this
  // is a wall — blocked, never grounded). The finer walkable-vs-Sliding
  // split within that band is this project's own job (`beginCapsuleTick`'s
  // `tooSteepToWalk` branch + `CharacterStateMachine`), reading the actual
  // ground-contact normal directly rather than leaning on a second Rapier
  // threshold — the ADR's "two explicit, independent thresholds" are
  // WALKABLE_SLOPE_MAX_ANGLE and WALL_NORMAL_MAX_Y, not two Rapier knobs.
  const wallAngle = Math.acos(WALL_NORMAL_MAX_Y);
  controller.setMaxSlopeClimbAngle(wallAngle);
  controller.setMinSlopeSlideAngle(wallAngle);
  controller.setApplyImpulsesToDynamicBodies(false);

  return { world, body, collider, controller };
};
