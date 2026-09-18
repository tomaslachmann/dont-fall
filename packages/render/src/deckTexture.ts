import * as THREE from "three";

/**
 * Loading and tiling a Surface sheet's texture, once for ice and bounce and
 * both renderers (2026-09 audit §3). Mud had one too, until it became
 * geometry (ADR 0103).
 *
 * Before this there were six copies of each: `loadIceTexture`,
 * `loadMudTexture` and `loadBounceTexture` in `apps/client/src/render/`, and
 * their three twins in `apps/track-builder/src/assets/`. The builder's own
 * comment on the duplication said a shared home was "too small for a package
 * and the wrong mandate for `@dont-fall/ui`" — true when it was written, and
 * no longer: `@dont-fall/render` exists (ADR 0074) and both apps already
 * import it.
 *
 * What still differs between the kinds is real and stays where it is — the
 * bounce sheet's dome and dents, ice's opacity. What is here is only what was
 * identical in all six.
 */

/** Decode fetched image bytes into something a `THREE.Texture` can wrap — injected in tests, where jsdom decodes nothing. */
export type DecodeDeckImage = (bytes: Uint8Array) => Promise<ImageBitmap>;

const decodeImageBitmap: DecodeDeckImage = (bytes) =>
  createImageBitmap(new Blob([bytes as unknown as BlobPart], { type: "image/jpeg" }));

/**
 * One Surface sheet's texture, fetched through the same bytes pipe as the GLB
 * art and colour-corrected (sRGB) — without which it renders washed out next
 * to the deck's own lit art.
 */
export const loadDeckTexture = async (
  fetchBytes: (url: string) => Promise<Uint8Array>,
  baseUrl: string,
  file: string,
  decode: DecodeDeckImage = decodeImageBitmap,
): Promise<THREE.Texture> => {
  const bitmap = await decode(await fetchBytes(`${baseUrl}/${file}`));
  const texture = new THREE.Texture(bitmap);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
};

export interface DeckTilingOptions {
  /** World units one texture tile spans — the kind's own `*_TILE_WORLD`. */
  tileWorld: number;
  /** The deck's size, which is what the repeat is counted in. */
  width: number;
  depth: number;
  maxAnisotropy?: number;
}

/**
 * A per-sheet clone of `texture`, repeating on the deck's own size. A clone
 * per sheet because the image is shared but the repeat is not: one texture
 * object could only ever tile for one deck.
 */
export const tileDeckTexture = (
  texture: THREE.Texture,
  { tileWorld, width, depth, maxAnisotropy = 1 }: DeckTilingOptions,
): THREE.Texture => {
  const sheet = texture.clone();
  sheet.needsUpdate = true;
  sheet.wrapS = THREE.RepeatWrapping;
  sheet.wrapT = THREE.RepeatWrapping;
  sheet.repeat.set(width / tileWorld, depth / tileWorld);
  sheet.anisotropy = maxAnisotropy;
  return sheet;
};
