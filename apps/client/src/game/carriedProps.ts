import { PROP_TOSS_TAP_MS, rotateVec3ByQuat, type PropSnapshot, type Vec3 } from "@dont-fall/shared";
import type { CarriedProp } from "../render/scene.js";

/** One Character that may carry a Prop this frame, as drawn: `null` is the local one. */
export interface PossibleCarrier {
  id: string | null;
  carryingProp: number | null;
  spinMs: number;
}

/**
 * Every Prop in someone's hands this frame (ADR 0128), for
 * `Stage.holdCarriedProps` — each with what it takes to hang it between the
 * drawn hands: its size and where its middle is on its body, turned as the
 * Prop is drawn.
 */
export const carriedPropsOf = (
  carriers: readonly PossibleCarrier[],
  props: readonly PropSnapshot[],
  gripShape: (index: number) => { localCentre: Vec3; radius: number } | null,
): CarriedProp[] =>
  carriers.flatMap(({ id, carryingProp, spinMs }) => {
    if (carryingProp === null) return [];
    const drawn = props[carryingProp];
    const shape = gripShape(carryingProp);
    if (!drawn || !shape) return [];
    return [
      {
        propIndex: carryingProp,
        carrierId: id,
        radius: shape.radius,
        spinning: spinMs > PROP_TOSS_TAP_MS,
        centreOffset: rotateVec3ByQuat(shape.localCentre, drawn.rotation),
      },
    ];
  });
