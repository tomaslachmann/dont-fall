import { CARRY_GRIP, handsOffset, SPIN_GRIP } from "@dont-fall/shared";
import * as THREE from "three";
import { boneOf } from "./characterModel.js";

/**
 * A carried Prop drawn in its carrier's hands (ADR 0128) — between the two
 * hand bones the rig has *this frame*, not at the grip the server holds it
 * at. That is what keeps the Prop in the hands through everything the server
 * knows nothing about: the Lift's stand-up after the touch, the Toss's
 * wind-up, the walk's sway, a Spin's crossfades. No hand curve is kept in
 * step with the clips anywhere.
 */
export interface CarrierHands {
  /** The two hand bones' world positions and the rig's world orientation, with its matrices brought up to date. */
  read: () => { left: THREE.Vector3; right: THREE.Vector3; orientation: THREE.Quaternion } | null;
}

/** {@link CarrierHands} over one rig's model, whose own forward is +Z (`MODEL_YAW_OFFSET` is 0). */
export const carrierHands = (model: THREE.Object3D): CarrierHands => {
  const left = boneOf(model, "hand.L");
  const right = boneOf(model, "hand.R");
  const at = { left: new THREE.Vector3(), right: new THREE.Vector3(), orientation: new THREE.Quaternion() };
  return {
    read: () => {
      if (!left || !right) return null;
      model.updateMatrixWorld(true);
      left.getWorldPosition(at.left);
      right.getWorldPosition(at.right);
      model.getWorldQuaternion(at.orientation);
      return at;
    },
  };
};

/** How long (s) the Prop takes to move between the carry's grip and a Spin's — the gait crossfade's length, so it moves as the arms do. */
const GRIP_BLEND_SECONDS = 0.15;

const FORWARD = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Where each carried Prop is drawn, from its carrier's hands (ADR 0128).
 * Keeps, per carrier, how far it has moved from the carry's grip toward a
 * Spin's, since the arms crossfade between the two poses rather than cut.
 */
export class CarriedPropPlacer {
  private readonly spinBlend = new Map<string, number>();
  private readonly forward = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  /**
   * The middle of a Prop of `radius` carried by `carrierId`, drawn this frame
   * — or `null` when its rig has no hands to hold it with.
   */
  place(
    carrierId: string,
    hands: CarrierHands,
    radius: number,
    spinning: boolean,
    deltaSeconds: number,
    into: THREE.Vector3,
  ): THREE.Vector3 | null {
    const read = hands.read();
    if (!read) return null;
    const step = deltaSeconds / GRIP_BLEND_SECONDS;
    const was = this.spinBlend.get(carrierId) ?? (spinning ? 1 : 0);
    const blend = spinning ? Math.min(1, was + step) : Math.max(0, was - step);
    this.spinBlend.set(carrierId, blend);
    const carry = handsOffset(radius, CARRY_GRIP);
    const spin = handsOffset(radius, SPIN_GRIP);
    const forward = carry.forward + (spin.forward - carry.forward) * blend;
    const up = carry.up + (spin.up - carry.up) * blend;
    this.forward.copy(FORWARD).applyQuaternion(read.orientation);
    this.up.copy(UP).applyQuaternion(read.orientation);
    return into
      .copy(read.left)
      .add(read.right)
      .multiplyScalar(0.5)
      .addScaledVector(this.forward, forward)
      .addScaledVector(this.up, up);
  }

  /** Forget carriers no longer carrying, so the next carry starts from the carry's grip. */
  keepOnly(carrierIds: ReadonlySet<string>): void {
    for (const id of this.spinBlend.keys()) if (!carrierIds.has(id)) this.spinBlend.delete(id);
  }
}
