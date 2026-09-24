import RAPIER from "@dimforge/rapier3d-compat";
import { vec3, type Vec3 } from "../../math/vec3.js";
import { CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS } from "../../tuning/character.js";
import {
  GETUP_SPOT_DIRECTIONS,
  GETUP_SPOT_FLOOR_GRAZE,
  GETUP_SPOT_RISE_STEP,
  GETUP_SPOT_RISE_STEPS,
  GETUP_SPOT_SEARCH_RADIUS,
  GETUP_SPOT_SEARCH_STEP,
} from "../../tuning/knockdown.js";
import { collisionGroups, GROUP_CHARACTER, GROUP_STATIC } from "../collisionGroups.js";
import type { Capsule } from "./Capsule.js";

/**
 * What a standing capsule may not start inside: still geometry — the Track's
 * statics, its trimeshes and its Moving Segments where they are now. Not
 * Props (a standing capsule shoves them), not a Spinner, not another
 * Character, not any ragdoll's bones, and never a sensor.
 */
const STILL_GEOMETRY = collisionGroups(GROUP_CHARACTER, GROUP_STATIC);
const PROBE = new RAPIER.Capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS);
const UPRIGHT = { x: 0, y: 0, z: 0, w: 1 };

/**
 * Where a Character getting up stands (found by M17 ticket 06b on Slip
 * Stream): the get-up clip's own origin, `wanted`, unless the capsule would
 * start there inside still geometry — a heap a belt pressed against a barrier
 * gets up with its clip origin a few decimetres past its pelvis, which is
 * inside the barrier, and a kinematic capsule that starts inside a trimesh
 * never leaves it.
 *
 * Then the nearest spot that is clear, searched outward from `wanted` in
 * rings (each ring starting toward the pelvis, where the body really lies,
 * and alternating either side of it), and at each distance a little higher
 * before any further — a heap resting on a ramp gets up where it lies, just
 * clear of the slope. A spot only counts if nothing still stands between it
 * and the body, so a get-up never stands up on the far side of a thin wall.
 * Nothing clear within {@link GETUP_SPOT_SEARCH_RADIUS} keeps `wanted`, as
 * before.
 *
 * `pelvis` is the settled ragdoll's root, which the bones' own collisions
 * keep on the right side of everything. Pure over the world's colliders and
 * the replicated bones, so a predicting client finds the same spot the
 * server does.
 */
export const getUpSpot = (capsule: Capsule, wanted: Vec3, pelvis: Vec3): Vec3 => {
  const toPelvis = Math.atan2(pelvis.z - wanted.z, pelvis.x - wanted.x);
  const rings = Math.round(GETUP_SPOT_SEARCH_RADIUS / GETUP_SPOT_SEARCH_STEP);
  for (let ring = 0; ring <= rings; ring += 1) {
    const radius = ring * GETUP_SPOT_SEARCH_STEP;
    for (let rise = 0; rise <= GETUP_SPOT_RISE_STEPS; rise += 1) {
      const y = wanted.y + rise * GETUP_SPOT_RISE_STEP;
      const directions = ring === 0 ? 1 : GETUP_SPOT_DIRECTIONS;
      for (let n = 0; n < directions; n += 1) {
        // 0, +1, −1, +2, −2, …: toward the pelvis first, then fanning out.
        const turn = n % 2 === 1 ? (n + 1) / 2 : -n / 2;
        const angle = toPelvis + (turn * 2 * Math.PI) / GETUP_SPOT_DIRECTIONS;
        const spot = vec3(wanted.x + Math.cos(angle) * radius, y, wanted.z + Math.sin(angle) * radius);
        if (isClear(capsule, spot) && isInReach(capsule, pelvis, spot)) return spot;
      }
    }
  }
  return wanted;
};

/** Whether a standing capsule at `spot` overlaps no still geometry — the floor it stands on grazed by up to {@link GETUP_SPOT_FLOOR_GRAZE}. */
const isClear = (capsule: Capsule, spot: Vec3): boolean =>
  capsule.world.intersectionWithShape(
    { x: spot.x, y: spot.y + GETUP_SPOT_FLOOR_GRAZE, z: spot.z },
    UPRIGHT,
    PROBE,
    RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
    STILL_GEOMETRY,
    capsule.collider,
  ) === null;

/** Whether nothing still stands between the body, at `spot`'s height over the pelvis, and `spot`. */
const isInReach = (capsule: Capsule, pelvis: Vec3, spot: Vec3): boolean => {
  const dx = spot.x - pelvis.x;
  const dz = spot.z - pelvis.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 1e-6) return true;
  const ray = new RAPIER.Ray({ x: pelvis.x, y: spot.y, z: pelvis.z }, { x: dx / distance, y: 0, z: dz / distance });
  return (
    capsule.world.castRay(ray, distance, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, STILL_GEOMETRY, capsule.collider) ===
    null
  );
};
