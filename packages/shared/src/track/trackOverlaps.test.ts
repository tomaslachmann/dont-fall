import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { initPhysics } from "../simulation/RapierSimulation.js";
import { at, spin } from "./authoring.js";
import { loadAssetLibrary } from "./assetModules.js";
import type { Module } from "./Module.js";
import { findOverlaps } from "./trackOverlaps.js";

const assetsRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");
let library: Record<string, Module>;
beforeAll(async () => {
  await initPhysics();
  library = await loadAssetLibrary(
    async (url) => new Uint8Array(readFileSync(join(assetsRoot, url.substring(url.lastIndexOf("/") + 1)))),
    "http://assets.test",
  );
});

describe("findOverlaps", () => {
  it("lets two decks butt edge to edge, and finds one pushed half a metre into the other", () => {
    const butted = [at("kaykit_platform_4x4x1_blue", 0, 0, 0), at("kaykit_platform_4x4x1_red", 4, 0, 0)];
    const sunk = [at("kaykit_platform_4x4x1_blue", 0, 0, 0), at("kaykit_platform_4x4x1_red", 3.5, 0, 0)];

    expect(findOverlaps(library, butted)).toEqual([]);
    const [found] = findOverlaps(library, sunk);
    expect(found).toMatchObject({ a: 0, b: 1 });
    expect(found!.depth).toBeCloseTo(0.5, 1);
  });

  it("finds a bar that only clips a post on its way round, and says when", () => {
    const bar = at("kaykit_barrier_4x1x1_red", 0, 0.05, 0, { motion: spin(Math.PI / 2) });
    // Straight ahead of the bar's middle, inside its reach: clear at rest, hit a quarter turn later.
    const post = at("kaykit_pillar_1x1x2", 0, 0, 1.6);

    const [found] = findOverlaps(library, [bar, post]);
    expect(found).toMatchObject({ a: 0, b: 1 });
    expect(found!.tick).toBeGreaterThan(0);
  });
});
