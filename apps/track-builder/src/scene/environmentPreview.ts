import { localBounds, lowestDrawnY, lowestMovingY } from "@dont-fall/render";
import { hasMotion, segmentOrientation, segmentScale, type Track } from "@dont-fall/shared";
import type * as THREE from "three";
import { MOTION_NODE } from "./render.js";

/**
 * The lowest Y the drawn Track reaches, for the Environment preview's cloud
 * floor (ADR 0074) — the same bound the game's Stage computes, so the preview
 * puts the floor where a Round does. A still Segment counts where it stands; a
 * moving one counts everywhere its Motion can carry it, measured from its
 * Motion node, whose contents sit at rest in the Segment's unscaled frame.
 * `Infinity` for an empty Track.
 */
export const lowestSegmentY = (groups: readonly THREE.Object3D[], track: Track): number => {
  let lowest = Infinity;
  for (const group of groups) {
    const index = group.userData.segmentIndex as number | undefined;
    const segment = index === undefined ? undefined : track[index];
    if (!segment) continue;
    const motionNode = group.userData[MOTION_NODE] as THREE.Object3D | undefined;
    if (!hasMotion(segment.motion) || !motionNode) {
      lowest = Math.min(lowest, lowestDrawnY([group]));
      continue;
    }
    const scale = segmentScale(segment);
    const bounds = localBounds(motionNode);
    bounds.min.multiplyScalar(scale);
    bounds.max.multiplyScalar(scale);
    lowest = Math.min(
      lowest,
      lowestMovingY(bounds, { position: segment.position, orientation: segmentOrientation(segment), scale, motion: segment.motion }),
    );
  }
  return lowest;
};
