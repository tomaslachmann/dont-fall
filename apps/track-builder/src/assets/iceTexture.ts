import { ICE_TEXTURE_FILE } from "@dont-fall/shared";
import * as THREE from "three";

/**
 * The builder half of the ice loader (ADR 0066) — a deliberate duplicate of
 * the client's `loadIceTexture` in
 * `apps/client/src/render/iceOverlays.ts`: ~15 lines, too small for a
 * package and the wrong mandate for `@dont-fall/ui`. Each copy points at
 * its twin and each is pinned by its app's tests. Same URL off the same
 * `/assets` base, same sRGB wrap, so a sheet reads identically in the game
 * and the viewport.
 */

/**
 * Decode fetched image bytes into something a `THREE.Texture` can wrap —
 * `createImageBitmap` in browsers, injected in tests (jsdom decodes
 * nothing). The same seam as the client's twin.
 */
export type DecodeIceImage = (bytes: Uint8Array) => Promise<ImageBitmap>;

const decodeImageBitmap: DecodeIceImage = (bytes) =>
  createImageBitmap(new Blob([bytes as unknown as BlobPart], { type: "image/jpeg" }));

/** The shared ice texture, fetched through the same bytes pipe as the GLB art. */
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
