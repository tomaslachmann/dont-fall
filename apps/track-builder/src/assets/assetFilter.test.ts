import type { AssetCategory } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { assetPackOf, filterAssetIds, packLabel, type AssetFilterState } from "./assetFilter.js";

const byId: Record<string, AssetCategory> = {
  kaykit_floor_wood_2x2: "floor",
  kaykit_arch_blue: "sweeper",
  kaykit_tree_pine: "scenery",
  trap_arch: "sweeper",
  trap_spikes: "sweeper",
};
const ids = Object.keys(byId);
const all: AssetFilterState = { query: "", category: null, pack: null, saved: null, sort: "asc" };

describe("assetPackOf", () => {
  it("derives the pack from the id prefix", () => {
    expect(assetPackOf("kaykit_floor_wood_2x2")).toBe("kaykit");
    expect(assetPackOf("trap_arch")).toBe("trap");
  });

  it("labels the known packs by brand, anything else capitalized", () => {
    expect(packLabel("kaykit")).toBe("KayKit");
    expect(packLabel("trap")).toBe("Trap");
    expect(packLabel("future")).toBe("Future");
  });
});

describe("filterAssetIds", () => {
  it("with no filters returns every id, A–Z", () => {
    expect(filterAssetIds(ids, byId, all)).toEqual([...ids].sort());
  });

  it("narrows category → pack → saved set → query, in that order", () => {
    expect(filterAssetIds(ids, byId, { ...all, category: "sweeper" })).toEqual([
      "kaykit_arch_blue",
      "trap_arch",
      "trap_spikes",
    ]);
    expect(filterAssetIds(ids, byId, { ...all, category: "sweeper", pack: "trap" })).toEqual([
      "trap_arch",
      "trap_spikes",
    ]);
    expect(
      filterAssetIds(ids, byId, { ...all, category: "sweeper", pack: "trap", saved: new Set(["trap_spikes"]) }),
    ).toEqual(["trap_spikes"]);
    expect(filterAssetIds(ids, byId, { ...all, query: "ARCH" })).toEqual(["kaykit_arch_blue", "trap_arch"]);
  });

  it("sorts Z–A on request", () => {
    expect(filterAssetIds(ids, byId, { ...all, sort: "desc" })).toEqual([...ids].sort().reverse());
  });
});
