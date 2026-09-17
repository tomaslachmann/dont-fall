import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BASE_RACE_TRACK } from "./baseRace.js";
import { assetIdsOf, createAssetLibraryLoader, missingAssetIds } from "./assetModules.js";
import { MODULE_LIBRARY } from "./modules.js";
import type { Track } from "./Track.js";

const assetsRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");

/** Real bytes off disk, counting every fetch by file name. */
const countingFetch = () => {
  const fetched: string[] = [];
  const fetchBytes = async (url: string): Promise<Uint8Array> => {
    const fileName = url.substring(url.lastIndexOf("/") + 1);
    fetched.push(fileName);
    return new Uint8Array(readFileSync(join(assetsRoot, fileName)));
  };
  return { fetched, fetchBytes };
};

const at = (moduleId: string, z = 0): Track[number] => ({ moduleId, position: { x: 0, y: 0, z }, rotation: 0 });

describe("assetIdsOf (memory-footprint ticket 01)", () => {
  it("lists each placed Asset once, in the order first placed, and nothing procedural or unknown", () => {
    const track: Track = [
      at("kaykit_arch_green"),
      at("start"),
      at("kaykit_arch_blue", 4),
      at("kaykit_arch_green", 8),
      at("no_such_module"),
    ];
    expect(assetIdsOf(track)).toEqual(["kaykit_arch_green", "kaykit_arch_blue"]);
  });

  it("finds the base race's 33 Assets", () => {
    expect(assetIdsOf(BASE_RACE_TRACK)).toHaveLength(33);
  });
});

describe("createAssetLibraryLoader (memory-footprint ticket 01)", () => {
  it("fetches exactly the files a Track places", async () => {
    const { fetched, fetchBytes } = countingFetch();
    const loader = createAssetLibraryLoader(fetchBytes, "http://assets.test");
    const library = await loader.load(assetIdsOf([at("kaykit_arch_green"), at("kaykit_arch_blue", 4), at("kaykit_arch_green", 8)]));

    expect(fetched.sort()).toEqual(["kaykit_arch_blue.glb", "kaykit_arch_green.glb"]);
    expect(Object.keys(library).sort()).toEqual(["kaykit_arch_blue", "kaykit_arch_green"]);
    expect(library.kaykit_arch_green!.asset?.meshes.length).toBeGreaterThan(0);
  });

  it("fetches only the difference for the next Track, and keeps what it already holds", async () => {
    const { fetched, fetchBytes } = countingFetch();
    const loader = createAssetLibraryLoader(fetchBytes, "http://assets.test");
    const first = await loader.load(["kaykit_arch_green", "kaykit_arch_blue"]);
    fetched.length = 0;

    const second = await loader.load(["kaykit_arch_blue", "kaykit_arch_red"]);

    expect(fetched).toEqual(["kaykit_arch_red.glb"]);
    expect(Object.keys(second).sort()).toEqual(["kaykit_arch_blue", "kaykit_arch_green", "kaykit_arch_red"]);
    // Never parsed twice: the Module a running world was built from stays the same object.
    expect(second.kaykit_arch_blue).toBe(first.kaykit_arch_blue);
  });

  it("shares one fetch between loads that overlap in time", async () => {
    const { fetched, fetchBytes } = countingFetch();
    const loader = createAssetLibraryLoader(fetchBytes, "http://assets.test");
    await Promise.all([loader.load(["kaykit_arch_green"]), loader.load(["kaykit_arch_green"])]);
    expect(fetched).toEqual(["kaykit_arch_green.glb"]);
  });

  it("names a file that fails, and tries it again on the next load", async () => {
    let failures = 1;
    const { fetched, fetchBytes } = countingFetch();
    const loader = createAssetLibraryLoader(async (url) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error("GET answered 503");
      }
      return fetchBytes(url);
    }, "http://assets.test");

    await expect(loader.load(["kaykit_arch_green"])).rejects.toThrow(/kaykit_arch_green.*503/);
    const library = await loader.load(["kaykit_arch_green"]);
    expect(fetched).toEqual(["kaykit_arch_green.glb"]);
    expect(library.kaykit_arch_green).toBeDefined();
  });

  it("ignores ids that are not Assets", async () => {
    const { fetched, fetchBytes } = countingFetch();
    const loader = createAssetLibraryLoader(fetchBytes, "http://assets.test");
    expect(await loader.load(["start", "no_such_module"])).toEqual({});
    expect(fetched).toEqual([]);
  });
});

describe("missingAssetIds (memory-footprint ticket 01)", () => {
  it("names the placed Assets a library has no geometry for", async () => {
    const { fetchBytes } = countingFetch();
    const loaded = await createAssetLibraryLoader(fetchBytes, "http://assets.test").load(["kaykit_arch_green"]);
    const track: Track = [at("kaykit_arch_green"), at("kaykit_arch_blue", 4), at("start")];
    expect(missingAssetIds(track, { ...MODULE_LIBRARY, ...loaded })).toEqual(["kaykit_arch_blue"]);
    expect(missingAssetIds(track, MODULE_LIBRARY)).toEqual(["kaykit_arch_green", "kaykit_arch_blue"]);
  });
});
