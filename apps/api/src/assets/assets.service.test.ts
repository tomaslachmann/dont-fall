import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ASSET_CONTENT_TYPE, defaultAssetsDir, parseAssetFileName, readAssetFile } from "./assets.service.js";

describe("parseAssetFileName", () => {
  it("accepts a plain <moduleId>.glb under /assets/", () => {
    expect(parseAssetFileName("/assets/some_module.glb")).toBe("some_module.glb");
  });

  it("accepts shared image maps (ADR 0066) — png and jpg alongside glb", () => {
    expect(parseAssetFileName("/assets/ice_surface.jpg")).toBe("ice_surface.jpg");
    expect(parseAssetFileName("/assets/ice_surface.png")).toBe("ice_surface.png");
  });

  it("rejects traversal, nested paths, wrong suffixes and query-dressed names", () => {
    expect(parseAssetFileName("/assets/../secret")).toBeNull();
    expect(parseAssetFileName("/assets/%2e%2e/secret")).toBeNull();
    expect(parseAssetFileName("/assets/sub/file.glb")).toBeNull();
    expect(parseAssetFileName("/assets/some_module.gltf")).toBeNull();
    expect(parseAssetFileName("/assets/ice_surface.jpeg")).toBeNull();
    expect(parseAssetFileName("/assets/notes.txt")).toBeNull();
    expect(parseAssetFileName("/assets/some_module.glb?revision=2")).toBeNull();
    expect(parseAssetFileName("/assets/")).toBeNull();
    expect(parseAssetFileName("/tracks/abc")).toBeNull();
  });
});

describe("readAssetFile", () => {
  const dir = mkdtempSync(join(tmpdir(), "dont-fall-assets-"));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reads back exact bytes with the binary content type", async () => {
    const bytes = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 1, 2, 3]);
    writeFileSync(join(dir, "some_module.glb"), bytes);

    const read = await readAssetFile(dir, "some_module.glb");
    expect(read.bytes).toEqual(bytes);
    expect(read.contentType).toBe(ASSET_CONTENT_TYPE);
  });

  it("serves image maps with their own content types (ADR 0066)", async () => {
    // Own scratch dir: the shared `dir` above is removed after every test,
    // so a second writer would land in a deleted directory.
    const scratch = mkdtempSync(join(tmpdir(), "dont-fall-assets-img-"));
    try {
      writeFileSync(join(scratch, "ice_surface.jpg"), new Uint8Array([0xff, 0xd8, 1]));
      writeFileSync(join(scratch, "ice_surface.png"), new Uint8Array([0x89, 0x50, 1]));

      expect((await readAssetFile(scratch, "ice_surface.jpg")).contentType).toBe("image/jpeg");
      expect((await readAssetFile(scratch, "ice_surface.png")).contentType).toBe("image/png");
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("throws a not-found error naming the file", async () => {
    await expect(readAssetFile(dir, "missing.glb")).rejects.toThrow(/missing\.glb/);
  });

  it("reads the real repo art byte-for-byte through the default dir", async () => {
    // Pins `defaultAssetsDir`'s climb (wrong depth silently serves nothing)
    // and the real pipeline end to end, without a socket.
    const expected = readFileSync(join(defaultAssetsDir(), "kaykit_floor_wood_2x2.glb"));
    const read = await readAssetFile(defaultAssetsDir(), "kaykit_floor_wood_2x2.glb");
    expect(Buffer.from(read.bytes)).toEqual(expected);
  });

  it("reads the real ice texture byte-for-byte through the default dir (ADR 0066)", async () => {
    const expected = readFileSync(join(defaultAssetsDir(), "ice_surface.jpg"));
    const read = await readAssetFile(defaultAssetsDir(), "ice_surface.jpg");
    expect(Buffer.from(read.bytes)).toEqual(expected);
    expect(read.contentType).toBe("image/jpeg");
  });
});
