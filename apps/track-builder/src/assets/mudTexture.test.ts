import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { MUD_TEXTURE_FILE } from "@dont-fall/shared";
import { loadMudTexture } from "./mudTexture.js";

describe("loadMudTexture (ADR 0067)", () => {
  it("fetches the served texture file and wraps the decoded bitmap colour-correctly", async () => {
    const seen: string[] = [];
    const bitmap = {} as ImageBitmap;
    const texture = await loadMudTexture(
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

    expect(seen).toEqual([`http://assets.test/${MUD_TEXTURE_FILE}`]);
    expect(texture.image).toBe(bitmap);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
  });
});
