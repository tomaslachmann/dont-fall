import {
  ICE_OVERLAY_LIFT,
  ICE_OVERLAY_OPACITY,
  ICE_TEXTURE_FILE,
  ICE_TILE_WORLD,
  type IceDeck,
  type MovingSegmentConfig,
} from "@dont-fall/shared";
import * as THREE from "three";
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

    // A clone per sheet: the image is shared, but the repeat is the deck's
    // own size — one texture object could only repeat for one deck.
    const sheet = texture.clone();
    sheet.needsUpdate = true;
    sheet.wrapS = THREE.RepeatWrapping;
    sheet.wrapT = THREE.RepeatWrapping;
    sheet.repeat.set((halfX * 2) / ICE_TILE_WORLD, (halfZ * 2) / ICE_TILE_WORLD);
    sheet.anisotropy = maxAnisotropy;
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
    const geometry = new THREE.PlaneGeometry(halfX * 2, halfZ * 2);
    geometry.rotateX(-Math.PI / 2); // the plane's height becomes depth: a flat XZ sheet
    const object = new THREE.Mesh(geometry, material);

    const movingIndex = moving.findIndex((c) => c.segmentIndex === ice.segmentIndex);
    seatOnDeck(object, ice.deck, ICE_OVERLAY_LIFT, moving[movingIndex]);
    return { object, movingIndex: movingIndex < 0 ? null : movingIndex };
  });
};

/**
 * Decode fetched image bytes into something a `THREE.Texture` can wrap —
 * `createImageBitmap` in browsers, injected in tests (jsdom decodes
 * nothing). Kept behind this seam so the loader stays a pure function of
 * `(fetch, decode)` with no ambient browser globals of its own.
 */
export type DecodeIceImage = (bytes: Uint8Array) => Promise<ImageBitmap>;

const decodeImageBitmap: DecodeIceImage = (bytes) =>
  createImageBitmap(new Blob([bytes as unknown as BlobPart], { type: "image/jpeg" }));

/**
 * The shared ice texture (ADR 0066) — fetched once per session through the
 * same bytes pipe as the GLB art, then cloned per sheet by
 * {@link buildIceOverlays}. Colour-correct (sRGB): without it the ice
 * renders washed out next to the deck's own lit art.
 */
export const loadIceTexture = async (
  fetchBytes: (url: string) => Promise<Uint8Array>,
  baseUrl: string,
  decode: DecodeIceImage = decodeImageBitmap,
): Promise<THREE.Texture> => {
  const bitmap = await decode(await fetchBytes(`${baseUrl}/${ICE_TEXTURE_FILE}`));
  const texture = new THREE.Texture(bitmap);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
};
