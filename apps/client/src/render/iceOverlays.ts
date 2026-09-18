import {
  ICE_OVERLAY_LIFT,
  ICE_OVERLAY_OPACITY,
  ICE_TEXTURE_FILE,
  ICE_TILE_WORLD,
  type IceDeck,
  type MovingSegmentConfig,
} from "@dont-fall/shared";
import * as THREE from "three";
import { deckRectGeometry, deckSheetGeometry, loadDeckTexture, tileDeckTexture, type DecodeDeckImage } from "@dont-fall/render";
import { seatOnDeck } from "./deckSeat.js";

/**
 * One deck's ice sheet (ADR 0066) — the shared texture repeated across the
 * Segment's own footprint at its deck top, translucent so the deck's own art
 * stays visible through it. Static once placed (ice doesn't march), so
 * unlike a conveyor strip this carries no update driver.
 */
export interface IceSheet {
  /**
   * The sheet, transformed into its parent's own frame — the scene for a
   * still Segment, the Moving Segment's group (placement only, motion
   * unapplied, exactly like its box visuals) for a moving one.
   */
  object: THREE.Mesh;
  /**
   * Index into the `moving` array this sheet rides, or `null` for a still
   * Segment (parent to the scene). Aligned with the stage's own
   * `movingGroups`, which follow the same array in the same order.
   */
  movingIndex: number | null;
}

export const buildIceOverlays = (
  decks: readonly IceDeck[],
  moving: readonly MovingSegmentConfig[],
  texture: THREE.Texture,
  maxAnisotropy = 1,
): IceSheet[] => {
  if (decks.length === 0) return [];
  return decks.map((ice) => {
    const { halfX, halfZ } = ice.deck;

    const sheet = tileDeckTexture(texture, { tileWorld: ICE_TILE_WORLD, width: halfX * 2, depth: halfZ * 2, maxAnisotropy });
    const material = new THREE.MeshStandardMaterial({
      map: sheet,
      transparent: true,
      opacity: ICE_OVERLAY_OPACITY,
      roughness: 0.4,
      metalness: 0,
      // Lit, like the deck it lies on — an unlit sheet would stay
      // full-bright where the deck shades, and read as floating. The polygon
      // offset wins depth at a decal's lift, where a bare 0.01 could z-fight
      // at a distance.
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    // Cut to the deck's own shape when it has one (ADR 0096) — a round piece
    // wore a square of ice before this. A deck whose top face is its footprint
    // has no plan and keeps the plane.
    const geometry = ice.deck.plan
      ? deckSheetGeometry(ice.deck.plan, halfX, halfZ)
      : deckRectGeometry(halfX * 2, halfZ * 2);
    const object = new THREE.Mesh(geometry, material);

    const movingIndex = moving.findIndex((c) => c.segmentIndex === ice.segmentIndex);
    seatOnDeck(object, ice.deck, ICE_OVERLAY_LIFT, moving[movingIndex]);
    return { object, movingIndex: movingIndex < 0 ? null : movingIndex };
  });
};

/** The shared ice texture (ADR 0066) — fetched once per session through the same bytes pipe as the GLB art, then tiled per sheet. */
export const loadIceTexture = (
  fetchBytes: (url: string) => Promise<Uint8Array>,
  baseUrl: string,
  decode?: DecodeDeckImage,
): Promise<THREE.Texture> => loadDeckTexture(fetchBytes, baseUrl, ICE_TEXTURE_FILE, decode);
