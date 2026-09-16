import { BOUNCE_TEXTURE_FILE } from "@dont-fall/shared";
import * as THREE from "three";

/**
 * The builder half of the bounce loader (ADR 0070) — a deliberate duplicate
 * of the client's `loadBounceTexture` in
 * `apps/client/src/render/bounceSheets.ts`, for exactly the reasons the
 * ice/mud twins give: ~15 lines, too small for a package and the wrong
 * mandate for `@dont-fall/ui`. Same URL off the same `/assets` base, same
 * sRGB wrap, so a sheet reads identically in the game and the viewport.
 */

/** Decode fetched image bytes — `createImageBitmap` in browsers, injected in tests. */
export type DecodeBounceImage = (bytes: Uint8Array) => Promise<ImageBitmap>;

const decodeImageBitmap: DecodeBounceImage = (bytes) =>
  createImageBitmap(new Blob([bytes as unknown as BlobPart], { type: "image/jpeg" }));

/** The shared bounce texture, fetched through the same bytes pipe as the GLB art. */
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
