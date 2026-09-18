import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { loadDeckTexture, tileDeckTexture } from "./deckTexture.js";

describe("loadDeckTexture", () => {
  // One loader for ice, mud and bounce, in the game and in the builder (2026-09
  // audit §3) — six copies of these ten lines before, each with its own test.
  it("fetches the named file off the assets base and wraps it sRGB", async () => {
    const bitmap = { width: 4, height: 4 } as unknown as ImageBitmap;
    const fetchBytes = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const decode = vi.fn(async () => bitmap);

    const texture = await loadDeckTexture(fetchBytes, "http://api.test/assets", "ice_surface.jpg", decode);

    expect(fetchBytes).toHaveBeenCalledWith("http://api.test/assets/ice_surface.jpg");
    expect(texture.image).toBe(bitmap);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
    // `needsUpdate` is write-only in three.js; what it does is bump the version.
    expect(texture.version).toBeGreaterThan(0);
  });
});

describe("tileDeckTexture", () => {
  it("repeats on the deck's own size, on a clone so one image can tile many decks", () => {
    const shared = new THREE.Texture();
    const a = tileDeckTexture(shared, { tileWorld: 2, width: 12, depth: 6, maxAnisotropy: 8 });
    const b = tileDeckTexture(shared, { tileWorld: 2, width: 4, depth: 4 });

    expect(a).not.toBe(shared);
    expect(a.repeat.x).toBe(6);
    expect(a.repeat.y).toBe(3);
    expect(a.anisotropy).toBe(8);
    expect(a.wrapS).toBe(THREE.RepeatWrapping);
    // The second deck's own tiling never disturbs the first's.
    expect(b.repeat.x).toBe(2);
    expect(a.repeat.x).toBe(6);
  });
});
