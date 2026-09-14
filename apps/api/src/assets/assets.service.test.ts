import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ASSET_CONTENT_TYPE, defaultAssetsDir, parseAssetFileName, readAssetFile } from "./assets.service.js";

describe("parseAssetFileName", () => {
  it("accepts a plain <moduleId>.glb under /assets/", () => {
    expect(parseAssetFileName("/assets/platform_straight.glb")).toBe("platform_straight.glb");
  });

  it("rejects traversal, nested paths, wrong suffixes and query-dressed names", () => {
    expect(parseAssetFileName("/assets/../secret")).toBeNull();
    expect(parseAssetFileName("/assets/%2e%2e/secret")).toBeNull();
    expect(parseAssetFileName("/assets/sub/file.glb")).toBeNull();
    expect(parseAssetFileName("/assets/platform_straight.gltf")).toBeNull();
    expect(parseAssetFileName("/assets/platform_straight.glb?revision=2")).toBeNull();
    expect(parseAssetFileName("/assets/")).toBeNull();
    expect(parseAssetFileName("/tracks/abc")).toBeNull();
  });
});

describe("readAssetFile", () => {
  const dir = mkdtempSync(join(tmpdir(), "dont-fall-assets-"));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reads back exact bytes with the binary content type", async () => {
    const bytes = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 1, 2, 3]);
    writeFileSync(join(dir, "platform_straight.glb"), bytes);

    const read = await readAssetFile(dir, "platform_straight.glb");
    expect(read.bytes).toEqual(bytes);
    expect(read.contentType).toBe(ASSET_CONTENT_TYPE);
  });

  it("throws a not-found error naming the file", async () => {
    await expect(readAssetFile(dir, "missing.glb")).rejects.toThrow(/missing\.glb/);
  });

  it("reads the real repo art byte-for-byte through the default dir", async () => {
    // Pins `defaultAssetsDir`'s climb (wrong depth silently serves nothing)
    // and the real pipeline end to end, without a socket.
    const expected = readFileSync(join(defaultAssetsDir(), "platform_straight.glb"));
    const read = await readAssetFile(defaultAssetsDir(), "platform_straight.glb");
    expect(Buffer.from(read.bytes)).toEqual(expected);
  });
});
