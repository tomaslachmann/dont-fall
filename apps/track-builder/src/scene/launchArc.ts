import {
  GRAVITY_Y,
  addVec3,
  launchVelocityFor,
  rotateVec3ByQuat,
  scaleVec3,
  segmentOrientation,
  segmentScale,
  launchHeightOf,
  type LaunchDef,
  type Segment,
  type Vec3,
} from "@dont-fall/shared";

export interface LaunchArc {
  /** The flight, sampled from the launch point to where it comes back level. */
  points: Vec3[];
  /** The top of that flight, in world space. */
  apex: Vec3;
  /** How far above the launch point the apex sits — the number the author typed. */
  height: number;
}

/**
 * Where a Spring throws you (ADR 0069), in world space — the builder's own
 * "show exactly what the simulation will do" (the discipline ADR 0061 set for
 * Motion), computed from the same `launchVelocityFor` and `GRAVITY_Y` the
 * simulation uses, so the drawn arc cannot promise a jump the Track won't
 * make.
 *
 * Ballistic and Character-free on purpose: it is the throw the Spring gives,
 * not a prediction of any particular runner's flight (whose own horizontal run
 * is added on top, and who may well steer mid-air).
 */
export const launchArcOf = (segment: Segment, def: LaunchDef, samples = 48): LaunchArc => {
  const orientation = segmentOrientation(segment);
  const scale = segmentScale(segment);
  const height = launchHeightOf(segment.launch, def);
  const origin = addVec3(segment.position, rotateVec3ByQuat(scaleVec3(def.trigger.center, scale), orientation));
  const velocity = rotateVec3ByQuat(launchVelocityFor(height), orientation);
  const g = Math.abs(GRAVITY_Y);

  // Back to the height it left at: the whole arc an author judges a gap by.
  // A Spring aimed level or downward (tilted past 90°) has no flight to draw.
  const flight = velocity.y > 0 ? (2 * velocity.y) / g : 0;
  const at = (t: number): Vec3 => ({
    x: origin.x + velocity.x * t,
    y: origin.y + velocity.y * t - 0.5 * g * t * t,
    z: origin.z + velocity.z * t,
  });

  const points: Vec3[] = [];
  for (let i = 0; i <= samples; i += 1) points.push(at((flight * i) / samples));
  return { points, apex: at(flight / 2), height: (velocity.y * velocity.y) / (2 * g) };
};
