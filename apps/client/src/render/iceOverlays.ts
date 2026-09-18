import type { IceDeck, MovingSegmentConfig } from "@dont-fall/shared";
import type * as THREE from "three";
import { ICE_SEAT_LIFT, buildIceSlab, motionCarry, type MudDeckPlacement } from "@dont-fall/render";
import { seatOnDeck } from "./deckSeat.js";

/**
 * One deck's ice (ADR 0066, drawn per ADR 0107) — an opaque pastel slab with
 * cracks, frozen bubbles and the odd sparkle, standing on the deck, while the
 * physics keeps colliding with the deck itself. Built by `@dont-fall/render`,
 * so the Track builder shows the same slab; this only seats it and drives its
 * glints on the game's own clock.
 */
export interface IceSheet {
  /**
   * The slab, transformed into its parent's own frame — the scene for a
   * still Segment, the Moving Segment's group (placement only, motion
   * unapplied, exactly like its box visuals) for a moving one.
   */
  object: THREE.Object3D;
  /**
   * Index into the `moving` array this slab rides, or `null` for a still
   * Segment (parent to the scene). Aligned with the stage's own
   * `movingGroups`, which follow the same array in the same order.
   */
  movingIndex: number | null;
  /** Sparkle at `tSeconds` — sim time, so the glints pause with the sim. */
  update: (tSeconds: number) => void;
}

/**
 * Every ice deck on the Track, built together: a deck's slab runs on across a
 * seam into a neighbouring ice deck that moves with it (the mud's own seam
 * rule), so each one is built knowing all the others.
 */
export const buildIceOverlays = (decks: readonly IceDeck[], moving: readonly MovingSegmentConfig[]): IceSheet[] => {
  const carriers = decks.map((ice) => moving.findIndex((c) => c.segmentIndex === ice.segmentIndex));
  const placements: MudDeckPlacement[] = decks.map((ice, i) => {
    const carrier = moving[carriers[i]!];
    return carrier
      ? { deck: ice.deck, carry: motionCarry(carrier.position, carrier.orientation, carrier.scale, carrier.motion) }
      : { deck: ice.deck };
  });
  return decks.map((ice, i) => {
    const slab = buildIceSlab(placements[i]!, placements);
    const movingIndex = carriers[i]!;
    seatOnDeck(slab.object, ice.deck, ICE_SEAT_LIFT, moving[movingIndex]);
    return { object: slab.object, movingIndex: movingIndex < 0 ? null : movingIndex, update: slab.glint };
  });
};
