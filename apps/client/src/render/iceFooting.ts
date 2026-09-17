import { CAPSULE_BOTTOM_OFFSET, type IceDeck, type MovingSegmentConfig, type Vec3 } from "@dont-fall/shared";
import * as THREE from "three";
import { seatOnDeck } from "./deckSeat.js";

/**
 * How far a Character's feet may be from an ice deck's top, above or below
 * it, and still stand on it (units). Wide enough for a capsule resting on a
 * ramp, whose lowest point is not straight under its centre. Narrow enough
 * that a jump is off the ice after a few frames.
 */
export const ICE_FOOTING_REACH = 0.25;

/** Whether a Character stands on ice, asked of its capsule centre in world space. */
export type IceFootingQuery = (centre: Vec3) => boolean;

/**
 * Where the ice is, for the Character's footing (ADR 0082): the ice decks
 * the sheets are drawn from, each as an invisible frame in the deck's own
 * plane. A frame sits under the same parent its sheet does, so a deck riding
 * a Moving Segment carries its footing with it. It doesn't depend on the ice
 * texture having loaded.
 *
 * Like the sheet, a deck counts as ice across its whole footprint
 * (`moduleHasIceSurface`). It is the ice the player sees, which is what the
 * wobble is drawn for.
 *
 * `parentOf` hands back what the deck's sheet parents under: the scene for a
 * still Segment (`null`), or that Moving Segment's group. The parent must
 * keep its world matrix current, as the Stage's moving groups do when they
 * are posed.
 */
export const createIceFooting = (
  decks: readonly IceDeck[],
  moving: readonly MovingSegmentConfig[],
  parentOf: (movingIndex: number | null) => THREE.Object3D,
): IceFootingQuery => createDeckFooting(decks, moving, parentOf);

/**
 * The same footing for any kind of sheeted deck — ice, mud or bounce all lie
 * as `{ segmentIndex, deck }` — which is how footsteps (M14 ticket 04) hear
 * what a foot lands on.
 */
export const createDeckFooting = (
  decks: readonly Pick<IceDeck, "segmentIndex" | "deck">[],
  moving: readonly MovingSegmentConfig[],
  parentOf: (movingIndex: number | null) => THREE.Object3D,
): IceFootingQuery => {
  if (decks.length === 0) return () => false;
  const frames = decks.map(({ segmentIndex, deck }) => {
    const frame = new THREE.Object3D();
    const movingIndex = moving.findIndex((config) => config.segmentIndex === segmentIndex);
    seatOnDeck(frame, deck, 0, moving[movingIndex]);
    const parent = parentOf(movingIndex < 0 ? null : movingIndex);
    parent.add(frame);
    frame.updateWorldMatrix(true, false);
    return { frame, halfX: deck.halfX, halfZ: deck.halfZ };
  });
  const feet = new THREE.Vector3();
  return (centre) =>
    frames.some(({ frame, halfX, halfZ }) => {
      frame.worldToLocal(feet.set(centre.x, centre.y - CAPSULE_BOTTOM_OFFSET, centre.z));
      return Math.abs(feet.x) <= halfX && Math.abs(feet.z) <= halfZ && Math.abs(feet.y) <= ICE_FOOTING_REACH;
    });
};
