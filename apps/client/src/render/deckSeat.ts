import {
  addVec3,
  conjugateQuat,
  IDENTITY_QUAT,
  mulQuat,
  rotateVec3ByQuat,
  subVec3,
  type DeckFrame,
  type MovingSegmentConfig,
  type Quat,
  type Vec3,
} from "@dont-fall/shared";
import type * as THREE from "three";

/**
 * Seats a deck overlay — a belt's chevrons, an ice, mud or bounce sheet — in
 * its deck's own plane: `lift` above the deck top along the deck's up, turned
 * by `turn` about that up, pitched and rolled with the Segment. A yaw-only
 * overlay lies flat over a ramp and floats above its low end.
 *
 * Under a Moving Segment the pose is expressed in the carrier's own frame
 * (motion unapplied): the group it parents under already carries placement ×
 * motion, so the overlay follows the carrier exactly like its visuals do.
 */
export const seatOnDeck = (
  object: THREE.Object3D,
  deck: DeckFrame,
  lift: number,
  carrier: MovingSegmentConfig | undefined,
  turn: Quat = IDENTITY_QUAT,
): void => {
  let position: Vec3 = addVec3(deck.center, rotateVec3ByQuat({ x: 0, y: lift, z: 0 }, deck.orientation));
  let rotation: Quat = mulQuat(deck.orientation, turn);
  if (carrier) {
    const inv = conjugateQuat(carrier.orientation);
    position = rotateVec3ByQuat(subVec3(position, carrier.position), inv);
    rotation = mulQuat(inv, rotation);
  }
  object.position.set(position.x, position.y, position.z);
  object.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
};

/** A world point in the deck's own frame: x/z across the deck from its centre, y above its top. */
export const toDeckFrame = (deck: DeckFrame, point: Vec3): Vec3 =>
  rotateVec3ByQuat(subVec3(point, deck.center), conjugateQuat(deck.orientation));
