import type { MovingSegmentConfig, Vec3 } from "@dont-fall/shared";
import * as THREE from "three";

/**
 * The lowest world Y any of `objects` draws at, from their geometry's
 * bounding boxes; `Infinity` when none of them draws anything. What
 * `EnvironmentOptions.lowestSegmentY` is made of for a Track's still pieces.
 */
export const lowestDrawnY = (objects: Iterable<THREE.Object3D>): number => {
  const bounds = new THREE.Box3();
  let lowest = Infinity;
  for (const object of objects) {
    bounds.setFromObject(object);
    lowest = Math.min(lowest, bounds.min.y);
  }
  return lowest;
};

/**
 * `root`'s geometry bounds in `root`'s own frame (its own position, turn and
 * scale taken off), wherever it is posed right now.
 */
export const localBounds = (root: THREE.Object3D): THREE.Box3 => {
  root.updateWorldMatrix(true, true);
  const toLocal = root.matrixWorld.clone().invert();
  const relative = new THREE.Matrix4();
  const part = new THREE.Box3();
  const bounds = new THREE.Box3();
  root.traverse((object) => {
    const geometry = (object as Partial<THREE.Mesh>).geometry;
    if (!geometry) return;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    bounds.union(part.copy(geometry.boundingBox!).applyMatrix4(relative.multiplyMatrices(toLocal, object.matrixWorld)));
  });
  return bounds;
};

const corners = (box: THREE.Box3): THREE.Vector3[] =>
  [0, 1, 2, 3, 4, 5, 6, 7].map(
    (i) =>
      new THREE.Vector3(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z,
      ),
  );

/**
 * The lowest world Y a Moving Segment's visual can ever reach while its
 * Motion (ADR 0061) runs — never above it, sometimes a little below, so a
 * cloud floor clamped under it (ADR 0074) never cuts through a swinging or
 * sliding piece.
 *
 * `bounds` is the visual's geometry at rest in the Segment's local frame,
 * already scaled (`localBounds` of the Stage's Moving Segment group; the
 * builder scales its unscaled Motion node's). The bound follows
 * `movingSegmentPose`: spin, then swing, both rigid turns about a pivot, so a
 * point stays as far from the pivot as it starts; then a slide, which adds
 * between none and all of its offset.
 */
export const lowestMovingY = (
  bounds: THREE.Box3,
  config: Pick<MovingSegmentConfig, "position" | "orientation" | "scale" | "motion">,
): number => {
  if (bounds.isEmpty()) return Infinity;

  const orientation = new THREE.Quaternion(config.orientation.x, config.orientation.y, config.orientation.z, config.orientation.w);
  const rest = new THREE.Matrix4().compose(
    new THREE.Vector3(config.position.x, config.position.y, config.position.z),
    orientation,
    new THREE.Vector3(1, 1, 1),
  );
  // Motion pivots and offsets are authored unscaled; the geometry is already scaled.
  const toWorld = (local: Vec3): THREE.Vector3 =>
    new THREE.Vector3(local.x, local.y, local.z).multiplyScalar(config.scale).applyMatrix4(rest);
  const restCorners = corners(bounds).map((corner) => corner.applyMatrix4(rest));
  const farthestFrom = (point: THREE.Vector3): number =>
    Math.max(...restCorners.map((corner) => corner.distanceTo(point)));

  const { spin, swing, slide } = config.motion;
  let lowest: number;
  if (!spin && !swing) {
    lowest = Math.min(...restCorners.map((corner) => corner.y));
  } else {
    // Everything a turn can carry the geometry to, as a ball about a pivot.
    let centre = toWorld((spin ?? swing)!.pivot);
    let radius = farthestFrom(centre);
    if (spin && swing) {
      // The swing carries the spin's whole ball around its own pivot.
      const pivot = toWorld(swing.pivot);
      radius += centre.distanceTo(pivot);
      centre = pivot;
    }
    lowest = centre.y - radius;
  }
  if (slide) {
    const offset = new THREE.Vector3(slide.offset.x, slide.offset.y, slide.offset.z)
      .multiplyScalar(config.scale)
      .applyQuaternion(orientation);
    lowest += Math.min(0, offset.y);
  }
  return lowest;
};
