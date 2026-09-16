import {
  CAPSULE_BOTTOM_OFFSET,
  MUD_OVERLAY_LIFT,
  MUD_RIPPLE_ABOVE_LIFT,
  MUD_RIPPLE_COLOR,
  MUD_RIPPLE_INTERVAL_SECONDS,
  MUD_RIPPLE_LIFT,
  MUD_RIPPLE_POOL_SIZE,
  MUD_SIDE_COLOR,
  MUD_SLOSH_PHASE_STEP,
  MUD_TEXTURE_FILE,
  MUD_TILE_WORLD,
  mudRipplePose,
  mudSloshOffset,
  type MovingSegmentConfig,
  type MudDeck,
  type Vec3,
} from "@dont-fall/shared";
import * as THREE from "three";
import { seatOnDeck } from "./deckSeat.js";

/**
 * Frozen mud for `prefers-reduced-motion`: the slosh parks at zero and no
 * new rings spawn — like the conveyor's frozen march, the meaning (this
 * deck is mud) never depended on the motion.
 */
const REDUCED_MOTION =
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * One deck's mud (ADR 0067) — a filled block the Segment's own footprint
 * across and ankle-deep, textured on top, cut earth down the sides to the
 * deck: feet below the surface read as sunk while the physics keeps
 * colliding with the deck itself. Alive once placed — the surface breathes
 * (slosh) and answers feet walking through it (rings) — so unlike a plain
 * decal this carries an update driver off sim time.
 */
export interface MudSheet {
  /**
   * The block, transformed into its parent's own frame — the scene for a
   * still Segment, the Moving Segment's group (placement only, motion
   * unapplied, exactly like its box visuals) for a moving one. Centred
   * vertically: the mud surface sits half the lift above the origin.
   */
  object: THREE.Mesh;
  /**
   * Index into the `moving` array this sheet rides, or `null` for a still
   * Segment (parent to the scene). Aligned with the stage's own
   * `movingGroups`, which follow the same array in the same order.
   */
  movingIndex: number | null;
  /**
   * Breathe the surface and answer feet at `tSeconds` (sim time, so mud
   * pauses with the sim) — `centres` are Character capsule centres in world
   * space; feet over this sheet ripple it, feet jumping over it ripple
   * nothing. Driven by the stage's own `updateMotion`.
   */
  update: (tSeconds: number, centres: readonly Vec3[]) => void;
}

export const buildMudOverlays = (
  decks: readonly MudDeck[],
  moving: readonly MovingSegmentConfig[],
  texture: THREE.Texture,
  maxAnisotropy = 1,
): MudSheet[] => {
  if (decks.length === 0) return [];
  return decks.map((mud) => {
    const { halfX, halfZ } = mud.deck;

    // A clone per sheet: the image is shared, but the repeat is the deck's
    // own size — and the slosh offset below — so one texture object could
    // only serve one deck.
    const sheet = texture.clone();
    sheet.needsUpdate = true;
    sheet.wrapS = THREE.RepeatWrapping;
    sheet.wrapT = THREE.RepeatWrapping;
    sheet.repeat.set((halfX * 2) / MUD_TILE_WORLD, (halfZ * 2) / MUD_TILE_WORLD);
    sheet.anisotropy = maxAnisotropy;
    const topMaterial = new THREE.MeshStandardMaterial({
      map: sheet,
      // Opaque and matte: mud is a mass you stand in, not a film you look
      // through — translucent mud would show the feet through instead of
      // sinking them. The polygon offset wins depth where the block's sides
      // run coplanar with the deck's own edges.
      transparent: false,
      roughness: 0.9,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    // One instance behind all five untextured slots — the sides are the
    // filled gap down to the deck, the bottom never faces a camera.
    const sideMaterial = new THREE.MeshStandardMaterial({
      color: MUD_SIDE_COLOR,
      roughness: 1,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const geometry = new THREE.BoxGeometry(halfX * 2, MUD_OVERLAY_LIFT, halfZ * 2);
    // Box faces [+x, -x, +y, -y, +z, -z]: the texture rides the +y top.
    const object = new THREE.Mesh(geometry, [
      sideMaterial,
      sideMaterial,
      topMaterial,
      sideMaterial,
      sideMaterial,
      sideMaterial,
    ]);

    // The ripple pool — flat rings, one baked-flat geometry shared across
    // the pool (scale differs, shape doesn't), a material each (opacity is
    // per-ring). Children of the block: they inherit its frame for free,
    // so a ring on a moving carrier needs no extra transform.
    const ringGeometry = new THREE.RingGeometry(0.85, 1, 28);
    ringGeometry.rotateX(-Math.PI / 2);
    const rings = Array.from({ length: MUD_RIPPLE_POOL_SIZE }, () => {
      const ring = new THREE.Mesh(
        ringGeometry,
        new THREE.MeshBasicMaterial({
          color: MUD_RIPPLE_COLOR,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        }),
      );
      ring.visible = false;
      object.add(ring);
      return { ring, bornAt: Number.NEGATIVE_INFINITY };
    });
    let lastSpawnAt = Number.NEGATIVE_INFINITY;
    const scratch = new THREE.Vector3();
    const phase = mud.segmentIndex * MUD_SLOSH_PHASE_STEP;

    const update = (tSeconds: number, centres: readonly Vec3[]): void => {
      // The breath — parked at zero for reduced motion, like the frozen
      // conveyor march. Negative offsets wrap cleanly under RepeatWrapping.
      const slosh = REDUCED_MOTION ? { u: 0, v: 0 } : mudSloshOffset(tSeconds, phase);
      sheet.offset.set(slosh.u, slosh.v);

      if (!REDUCED_MOTION && tSeconds - lastSpawnAt >= MUD_RIPPLE_INTERVAL_SECONDS) {
        let spawned = false;
        for (const centre of centres) {
          // Feet first in world space (the capsule centre minus the
          // capsule's own bottom reach), THEN into the sheet frame — under
          // a rotated carrier the local down is not world down.
          scratch.set(centre.x, centre.y - CAPSULE_BOTTOM_OFFSET, centre.z);
          object.worldToLocal(scratch);
          const over =
            Math.abs(scratch.x) <= halfX &&
            Math.abs(scratch.z) <= halfZ &&
            scratch.y <= MUD_OVERLAY_LIFT + MUD_RIPPLE_ABOVE_LIFT;
          if (!over) continue;
          // Steal the oldest slot when the pool is full — a crowd crossing
          // one deck still ripples under every Character, and the stolen
          // ring was nearest gone anyway.
          const slot = rings.reduce((a, b) => (a.bornAt <= b.bornAt ? a : b));
          slot.bornAt = tSeconds;
          slot.ring.position.set(scratch.x, MUD_OVERLAY_LIFT / 2 + MUD_RIPPLE_LIFT, scratch.z);
          slot.ring.visible = true;
          spawned = true;
        }
        if (spawned) lastSpawnAt = tSeconds;
      }

      for (const slot of rings) {
        if (!slot.ring.visible) continue;
        const pose = mudRipplePose(tSeconds - slot.bornAt);
        if (!pose) {
          slot.ring.visible = false;
          continue;
        }
        slot.ring.scale.setScalar(pose.radius);
        (slot.ring.material as THREE.MeshBasicMaterial).opacity = pose.opacity;
      }
    };

    const movingIndex = moving.findIndex((c) => c.segmentIndex === mud.segmentIndex);
    // Centred on half the lift: the block fills the gap down to the deck top.
    seatOnDeck(object, mud.deck, MUD_OVERLAY_LIFT / 2, moving[movingIndex]);
    return { object, movingIndex: movingIndex < 0 ? null : movingIndex, update };
  });
};

/**
 * Decode fetched image bytes into something a `THREE.Texture` can wrap —
 * `createImageBitmap` in browsers, injected in tests (jsdom decodes
 * nothing). Kept behind this seam so the loader stays a pure function of
 * `(fetch, decode)` with no ambient browser globals of its own.
 */
export type DecodeMudImage = (bytes: Uint8Array) => Promise<ImageBitmap>;

const decodeImageBitmap: DecodeMudImage = (bytes) =>
  createImageBitmap(new Blob([bytes as unknown as BlobPart], { type: "image/jpeg" }));

/**
 * The shared mud texture (ADR 0067) — fetched once per session through the
 * same bytes pipe as the GLB art, then cloned per sheet by
 * {@link buildMudOverlays}. Colour-correct (sRGB): without it the mud
 * renders washed out next to the deck's own lit art.
 */
export const loadMudTexture = async (
  fetchBytes: (url: string) => Promise<Uint8Array>,
  baseUrl: string,
  decode: DecodeMudImage = decodeImageBitmap,
): Promise<THREE.Texture> => {
  const bitmap = await decode(await fetchBytes(`${baseUrl}/${MUD_TEXTURE_FILE}`));
  const texture = new THREE.Texture(bitmap);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
};
