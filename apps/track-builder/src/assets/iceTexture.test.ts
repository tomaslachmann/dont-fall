import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ICE_TEXTURE_FILE } from "@dont-fall/shared";
import { loadIceTexture } from "./iceTexture.js";

describe("loadIceTexture (ADR 0066)", () => {
  it("fetches the served texture file and wraps the decoded bitmap colour-correctly", async () => {
    const seen: string[] = [];
    const bitmap = {} as ImageBitmap;
    const texture = await loadIceTexture(
      async (url) => {
        seen.push(url);
        return new Uint8Array([1, 2, 3]);
      },
      "http://assets.test",
      async (bytes) => {
        expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
        return bitmap;
      },
    );

    expect(seen).toEqual([`http://assets.test/${ICE_TEXTURE_FILE}`]);
    expect(texture.image).toBe(bitmap);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
  });
});
