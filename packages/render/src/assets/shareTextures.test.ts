import { readFileSync } from "node:fs";
import * as path from "node:path";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shareTextures, type SharedTextureCache } from "./shareTextures.js";

const assetsRoot = path.resolve(import.meta.dirname, "../../../../assets");

/** Stand-in decoded bitmaps: GLTFLoader decodes through `createImageBitmap`, which Node lacks. */
const bitmaps: { closed: boolean }[] = [];

beforeEach(() => {
  bitmaps.length = 0;
  // GLTFLoader reads the embedded image through `self.URL.createObjectURL`.
  vi.stubGlobal("self", globalThis);
  vi.stubGlobal("createImageBitmap", async () => {
    const bitmap = {
      width: 4,
      height: 4,
      closed: false,
      close() {
        bitmap.closed = true;
      },
    };
    bitmaps.push(bitmap);
    return bitmap;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const parse = async (moduleId: string): Promise<GLTF> => {
  const bytes = readFileSync(path.join(assetsRoot, `${moduleId}.glb`));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
};

const maps = (gltf: GLTF): THREE.Texture[] => {
  const found: THREE.Texture[] = [];
  gltf.scene.traverse((object) => {
    const material = (object as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (material?.map) found.push(material.map);
  });
  return found;
};

describe("shareTextures (M13, memory-footprint ticket 02)", () => {
  it("resolves the same embedded image in two files to one texture, and closes the duplicate's bitmap", async () => {
    const cache: SharedTextureCache = new Map();
    const first = await parse("kaykit_arch_blue");
    await shareTextures(first, cache);
    const second = await parse("kaykit_arch_green");
    const duplicate = maps(second)[0]!;
    await shareTextures(second, cache);

    const firstMap = maps(first)[0]!;
    expect(firstMap).toBeInstanceOf(THREE.Texture);
    expect(maps(second).every((map) => map === firstMap)).toBe(true);
    expect((duplicate.image as { closed: boolean }).closed).toBe(true);
    expect((firstMap.image as { closed: boolean }).closed).toBe(false);
    expect(cache.size).toBe(1);
  });

  it("keeps a texture whose sampling differs apart, however alike its image", async () => {
    const cache: SharedTextureCache = new Map();
    const first = await parse("kaykit_arch_blue");
    await shareTextures(first, cache);
    const second = await parse("kaykit_arch_green");
    const own = maps(second)[0]!;
    own.wrapS = own.wrapS === THREE.RepeatWrapping ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    await shareTextures(second, cache);

    expect(maps(second)[0]).toBe(own);
    expect((own.image as { closed: boolean }).closed).toBe(false);
    expect(cache.size).toBe(2);
  });

  it("leaves a lone file's textures as they were", async () => {
    const cache: SharedTextureCache = new Map();
    const gltf = await parse("kaykit_arch_blue");
    const before = maps(gltf);
    await shareTextures(gltf, cache);
    expect(maps(gltf)).toEqual(before);
    expect(bitmaps.every((bitmap) => !bitmap.closed)).toBe(true);
  });
});
