import * as THREE from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";

/**
 * Every Asset file embeds its own copy of its pack's texture: 457 files over
 * about six distinct images. Parsed one by one, each file decodes a fresh
 * 1024² bitmap and uploads it to the GPU again, which costs memory and a hitch
 * the first time each copy is drawn. A texture whose embedded image bytes and
 * sampling match one already in `cache` is swapped for that one, and the
 * duplicate's decoded bitmap is closed at once rather than left to the GC.
 *
 * Shared by the game and the Track builder (M13 with memory-footprint ticket
 * 02). Each app keeps its own `cache` for its page session.
 */
export type SharedTextureCache = Map<string, THREE.Texture>;

/** Two FNV-1a passes with different seeds — a content key, not a security hash. */
const contentKey = (bytes: Uint8Array): string => {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ bytes.length;
  for (let i = 0; i < bytes.length; i += 1) {
    a = Math.imul(a ^ bytes[i]!, 0x01000193);
    b = Math.imul(b ^ bytes[i]!, 0x5bd1e995);
  }
  return `${bytes.length}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
};

export const shareTextures = async (gltf: GLTF, cache: SharedTextureCache): Promise<void> => {
  const { parser } = gltf;
  const slots: { material: THREE.Material; key: string; texture: THREE.Texture }[] = [];
  gltf.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const [key, value] of Object.entries(material)) {
        if ((value as THREE.Texture | null)?.isTexture) slots.push({ material, key, texture: value as THREE.Texture });
      }
    }
  });

  const keyByTexture = new Map<THREE.Texture, string | null>();
  for (const { texture } of slots) {
    if (keyByTexture.has(texture)) continue;
    // A texture the loader cloned without a glTF association (a non-zero
    // `texCoord`) can't be traced to its image, so it simply stays unshared.
    const textureIndex = parser.associations.get(texture)?.textures;
    const bufferView =
      textureIndex === undefined ? undefined : parser.json.images?.[parser.json.textures[textureIndex].source]?.bufferView;
    if (bufferView === undefined) {
      keyByTexture.set(texture, null);
      continue;
    }
    const image = new Uint8Array((await parser.getDependency("bufferView", bufferView)) as ArrayBuffer);
    const sampling = [texture.colorSpace, texture.channel, texture.flipY, texture.wrapS, texture.wrapT, texture.magFilter, texture.minFilter];
    keyByTexture.set(texture, `${contentKey(image)}|${sampling.join(",")}`);
  }

  const replaced = new Set<THREE.Texture>();
  for (const { material, key, texture } of slots) {
    const textureKey = keyByTexture.get(texture);
    if (!textureKey) continue;
    const shared = cache.get(textureKey);
    if (!shared) {
      cache.set(textureKey, texture);
      continue;
    }
    if (shared === texture) continue;
    (material as unknown as Record<string, unknown>)[key] = shared;
    material.needsUpdate = true;
    replaced.add(texture);
  }

  // Release a duplicate's bitmap only when nothing in this file still draws
  // from its image (clones share one `source`).
  const stillUsed = new Set(slots.map((slot) => (slot.material as unknown as Record<string, THREE.Texture>)[slot.key]!.source));
  for (const texture of replaced) {
    if (stillUsed.has(texture.source)) continue;
    (texture.image as { close?: () => void } | null)?.close?.();
    texture.dispose();
  }
};
