import {
  BOUNCE_OVERLAY_LIFT,
  BOUNCE_PRESS_DEPTH,
  BOUNCE_PRESS_HEIGHT,
  BOUNCE_SHEET_SEGMENTS,
  BOUNCE_TEXTURE_FILE,
  BOUNCE_TILE_WORLD,
  BOUNCE_WOBBLE_MS,
  CAPSULE_BOTTOM_OFFSET,
  bounceDomeLift,
  bouncePressFalloff,
  bounceProfile,
  bounceWobble,
  type BounceDeck,
  type MovingSegmentConfig,
  type RenderCharacter,
  type Vec3,
} from "@dont-fall/shared";
import * as THREE from "three";
import { seatOnDeck, toDeckFrame } from "./deckSeat.js";

/**
 * One Character's push on the sheets this frame: where it stands, and how far
 * down it is pressing (units, positive = down). Depth already folds the
 * standing press and whatever is left of a landing's ring together — the
 * sheet itself only distributes it over its own vertices.
 */
export interface BouncePress {
  /** Capsule centre, world space. */
  position: Vec3;
  depth: number;
}

/** Below this landing speed a touchdown is a step, not an impact, and rings nothing. */
const IMPACT_MIN_SPEED = 3;

/**
 * A Character that stopped falling this frame, fast enough to ring a sheet:
 * a bounce deck's thump (M14 ticket 05). It is reported wherever it
 * happened. Whether a deck was under it is the caller's question.
 */
export interface BounceLanding {
  id: string;
  /** Capsule centre, world space. */
  position: Vec3;
  /** How fast it was falling (units/s). */
  speed: number;
}

/**
 * Turns replicated Character state into presses (ADR 0070).
 *
 * Every input is already on the wire — position and velocity — so a bouncing
 * deck needs no new replicated state of its own, the same argument ADR 0069
 * made for a Spring's squash. The peak-fall tracking mirrors the
 * simulation's own `airbornePeakFallSpeed`: a fall's true speed has to be
 * remembered while it happens, because by the time the Character is standing
 * again the number that caused the bounce is gone.
 */
export class BouncePresses {
  private readonly falling = new Map<string, number>();
  private readonly impacts = new Map<string, { atMs: number; speed: number }>();
  private landed: BounceLanding[] = [];

  /** Who landed in the last {@link update}. */
  landings(): readonly BounceLanding[] {
    return this.landed;
  }

  update(characters: Record<string, RenderCharacter>, nowMs: number): BouncePress[] {
    const presses: BouncePress[] = [];
    const live = new Set<string>();
    this.landed = [];

    for (const [id, character] of Object.entries(characters)) {
      live.add(id);
      const fallSpeed = Math.max(0, -character.velocity.y);
      const peak = character.velocity.y < 0 ? Math.max(this.falling.get(id) ?? 0, fallSpeed) : 0;
      const wasFalling = this.falling.get(id) ?? 0;
      this.falling.set(id, peak);

      // Stopped falling this frame, having fallen fast enough to matter: that
      // is the landing, whether the deck bounced it back or it simply stood.
      if (peak === 0 && wasFalling >= IMPACT_MIN_SPEED) {
        this.impacts.set(id, { atMs: nowMs, speed: wasFalling });
        this.landed.push({ id, position: { ...character.position }, speed: wasFalling });
      }

      const impact = this.impacts.get(id);
      const ring = impact ? bounceWobble(nowMs - impact.atMs, impact.speed) : 0;
      // Dropped on elapsed time, never on the value: the ring crosses zero
      // four times a second on its way down, and reading a crossing as "over"
      // would cut the wobble off mid-swing.
      if (impact && nowMs - impact.atMs >= BOUNCE_WOBBLE_MS) this.impacts.delete(id);

      // Everyone near the sheet presses it, standing or not: an inflatable
      // yields as you come down, not at the instant of contact, and the skin
      // stands high enough now (BOUNCE_DOME_RISE) that waiting for `grounded`
      // would have Characters visibly falling *through* it first. How near is
      // near is the sheet's own business — it fades the press out by height.
      const depth = BOUNCE_PRESS_DEPTH + ring;
      if (depth !== 0) presses.push({ position: { ...character.position }, depth });
    }

    for (const id of [...this.falling.keys()]) if (!live.has(id)) this.falling.delete(id);
    for (const id of [...this.impacts.keys()]) if (!live.has(id)) this.impacts.delete(id);
    return presses;
  }

  /** Forget everyone — a Track reload, where the sheets themselves are rebuilt. */
  reset(): void {
    this.falling.clear();
    this.impacts.clear();
    this.landed = [];
  }
}

/**
 * One deck's bounce sheet (ADR 0070) — a taut, convex skin over the deck that
 * dents under whoever stands on it and rings after a landing. The deck's own
 * collider never moves: this is skin, and the physics underneath stays the
 * flat box it always was.
 */
export interface BounceSheet {
  /** The sheet, in its parent's frame — the scene for a still Segment, the Moving Segment's group for a moving one. */
  object: THREE.Mesh;
  /** Index into the `moving` array this sheet rides, or `null` for a still Segment. */
  movingIndex: number | null;
  /** Reshape it for this frame's presses (world space). */
  update: (presses: readonly BouncePress[]) => void;
}

/**
 * Build one sheet per bouncy deck. Each is a subdivided plane laid flat over
 * its deck and reshaped every frame from {@link bounceDomeLift} and the
 * presses on it — so the geometry is the effect, and there is no shader to
 * keep in step with the shared maths.
 */
export const buildBounceSheets = (
  decks: readonly BounceDeck[],
  texture: THREE.Texture | null,
  moving: readonly MovingSegmentConfig[] = [],
): BounceSheet[] =>
  decks.map(({ segmentIndex, deck }) => {
    const width = deck.halfX * 2;
    const depth = deck.halfZ * 2;

    const geometry = new THREE.PlaneGeometry(width, depth, BOUNCE_SHEET_SEGMENTS, BOUNCE_SHEET_SEGMENTS);
    geometry.rotateX(-Math.PI / 2); // lie flat: the plane's own +Z becomes world -Z
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    // The flat lattice, kept as the rest state — every frame rewrites y from
    // it, so a dent can never accumulate into the mesh itself.
    const restX = Float32Array.from({ length: position.count }, (_, i) => position.getX(i));
    const restZ = Float32Array.from({ length: position.count }, (_, i) => position.getZ(i));

    const map = texture?.clone() ?? null;
    if (map) {
      map.needsUpdate = true;
      map.wrapS = THREE.RepeatWrapping;
      map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(width / BOUNCE_TILE_WORLD, depth / BOUNCE_TILE_WORLD);
    }
    const material = new THREE.MeshStandardMaterial({
      ...(map ? { map } : { color: 0x36c9f0 }),
      // Taut inflatable plastic: the map carries the grain, the material
      // carries the shine. Without the low roughness it reads as canvas.
      roughness: 0.18,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });

    const object = new THREE.Mesh(geometry, material);
    const movingIndex = moving.findIndex((config) => config.segmentIndex === segmentIndex);
    seatOnDeck(object, deck, BOUNCE_OVERLAY_LIFT, moving[movingIndex]);

    const update = (presses: readonly BouncePress[]): void => {
      const local: { x: number; z: number; depth: number }[] = [];
      for (const press of presses) {
        // Feet, not the capsule centre: a Character presses with its soles —
        // found in world space, then into the deck's own (tilted) frame.
        const { x, y: feet, z } = toDeckFrame(deck, { ...press.position, y: press.position.y - CAPSULE_BOTTOM_OFFSET });
        if (Math.abs(feet) > BOUNCE_PRESS_HEIGHT) continue;
        const fade = 1 - Math.abs(feet) / BOUNCE_PRESS_HEIGHT;
        local.push({ x, z, depth: press.depth * fade });
      }

      for (let i = 0; i < position.count; i += 1) {
        const x = restX[i]!;
        const z = restZ[i]!;
        const u = deck.halfX === 0 ? 0 : x / deck.halfX;
        const v = deck.halfZ === 0 ? 0 : z / deck.halfZ;
        let y = bounceDomeLift(u, v);
        // Shaped by the same profile as the dome, so the two cancel the same
        // way everywhere — near the rim as well as dead centre.
        const profile = bounceProfile(u, v);
        for (const press of local) {
          const distance = Math.hypot(x - press.x, z - press.z);
          const reach = bouncePressFalloff(distance);
          if (reach > 0) y -= press.depth * reach * profile;
        }
        position.setY(i, y);
      }
      position.needsUpdate = true;
      geometry.computeVertexNormals(); // the shine is the point; stale normals kill it
    };

    update([]);
    return { object, movingIndex: movingIndex < 0 ? null : movingIndex, update };
  });

/**
 * Decode fetched image bytes for the sheet — `createImageBitmap` in browsers,
 * injected in tests, exactly the seam the mud loader uses.
 */
export type DecodeBounceImage = (bytes: Uint8Array) => Promise<ImageBitmap>;

const decodeImageBitmap: DecodeBounceImage = (bytes) =>
  createImageBitmap(new Blob([bytes as unknown as BlobPart], { type: "image/jpeg" }));

/**
 * The shared bounce texture (ADR 0070) — fetched once per session through the
 * same bytes pipe as the GLB art, then cloned per sheet by
 * {@link buildBounceSheets}. Colour-correct (sRGB), like ice and mud.
 */
export const loadBounceTexture = async (
  fetchBytes: (url: string) => Promise<Uint8Array>,
  baseUrl: string,
  decode: DecodeBounceImage = decodeImageBitmap,
): Promise<THREE.Texture> => {
  const bitmap = await decode(await fetchBytes(`${baseUrl}/${BOUNCE_TEXTURE_FILE}`));
  const texture = new THREE.Texture(bitmap);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
};
