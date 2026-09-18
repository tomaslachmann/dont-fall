import { CAPSULE_BOTTOM_OFFSET, type MovingSegmentConfig, type MudDeck, type Vec3 } from "@dont-fall/shared";
import * as THREE from "three";
import { MUD_SEAT_LIFT, buildMudMass, motionCarry, type MudDeckPlacement } from "@dont-fall/render";
import { seatOnDeck } from "./deckSeat.js";

/**
 * Still mud for `prefers-reduced-motion`: nobody's feet sink into it and
 * nothing bubbles. Like the conveyor's frozen march, the meaning (this deck
 * is mud) never depended on the motion.
 */
const REDUCED_MOTION =
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * One deck's mud (ADR 0067, drawn per ADR 0103) — a heaped, bubbling mass
 * standing on the deck that feet sink into, while the physics keeps colliding
 * with the deck itself. Built by `@dont-fall/render`, so the Track builder shows the same
 * mud; this adds only what the game has and the builder does not: Characters
 * wading through it.
 */
export interface MudSheet {
  /**
   * The mass, transformed into its parent's own frame — the scene for a
   * still Segment, the Moving Segment's group (placement only, motion
   * unapplied, exactly like its box visuals) for a moving one.
   */
  object: THREE.Object3D;
  /**
   * Index into the `moving` array this sheet rides, or `null` for a still
   * Segment (parent to the scene). Aligned with the stage's own
   * `movingGroups`, which follow the same array in the same order.
   */
  movingIndex: number | null;
  /**
   * Press the mud under every Character in `centres` (capsule centres, world
   * space) at `tSeconds` — sim time, so mud pauses with the sim — let
   * earlier presses fill back in, and bubble. Feet jumping over it press
   * nothing.
   */
  update: (tSeconds: number, centres: readonly Vec3[]) => void;
}

/**
 * Every mud deck on the Track, built together: a deck's mud runs on across a
 * seam into a neighbouring mud deck that moves with it, so each one is built
 * knowing all the others.
 */
export const buildMudOverlays = (decks: readonly MudDeck[], moving: readonly MovingSegmentConfig[]): MudSheet[] => {
  const carriers = decks.map((mud) => moving.findIndex((c) => c.segmentIndex === mud.segmentIndex));
  const placements: MudDeckPlacement[] = decks.map((mud, i) => {
    const carrier = moving[carriers[i]!];
    return carrier
      ? { deck: mud.deck, carry: motionCarry(carrier.position, carrier.orientation, carrier.scale, carrier.motion) }
      : { deck: mud.deck };
  });
  return decks.map((mud, i) => {
    const mass = buildMudMass(placements[i]!, placements);
    const object = mass.object;
    const movingIndex = carriers[i]!;
    seatOnDeck(object, mud.deck, MUD_SEAT_LIFT, moving[movingIndex]);

    const feet: Vec3[] = [];
    const scratch = new THREE.Vector3();
    const update = (tSeconds: number, centres: readonly Vec3[]): void => {
      if (REDUCED_MOTION) return;
      feet.length = 0;
      for (const centre of centres) {
        // Feet first in world space (the capsule centre minus the capsule's
        // own bottom reach), THEN into the mud's frame — under a rotated
        // carrier the local down is not world down.
        scratch.set(centre.x, centre.y - CAPSULE_BOTTOM_OFFSET, centre.z);
        object.worldToLocal(scratch);
        feet.push({ x: scratch.x, y: scratch.y, z: scratch.z });
      }
      mass.wade(tSeconds, feet);
      mass.simmer(tSeconds);
    };
    return { object, movingIndex: movingIndex < 0 ? null : movingIndex, update };
  });
};
