import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { loadAssetLibrary } from "./assetModules.js";
import { deckPlanOf, smoothDeckPlan, type DeckPlan } from "./DeckPlan.js";
import type { Module } from "./Module.js";

const assetsRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");
let library: Record<string, Module>;
beforeAll(async () => {
  library = await loadAssetLibrary(
    async (url) => new Uint8Array(readFileSync(join(assetsRoot, url.substring(url.lastIndexOf("/") + 1)))),
    "http://assets.test",
  );
});

/** The plan's own area, which is what "cut to the shape" has to mean numerically. */
const areaOf = (plan: DeckPlan): number => {
  let area = 0;
  for (let t = 0; t + 2 < plan.indices.length; t += 3) {
    const a = plan.vertices[plan.indices[t]!]!;
    const b = plan.vertices[plan.indices[t + 1]!]!;
    const c = plan.vertices[plan.indices[t + 2]!]!;
    area += Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
  }
  return area;
};

describe("deckPlanOf (ADR 0096)", () => {
  // The bug this exists for: a quarter disc wearing a square of ice. A round
  // piece's top face is π/4 of its own footprint, and nothing but reading the
  // Asset's collision gets that number.
  it("cuts a round piece to its quarter disc, not its bounding square", () => {
    const plan = deckPlanOf(library.kaykit_platform_quarter_circle_blue!, 2);
    expect(plan).toBeDefined();
    const area = areaOf(plan!);
    // Radius 2 at this scale, so a quarter disc is π — approached from below,
    // since the authored arc is a fan of flat triangles inscribed in it.
    const quarterDisc = (Math.PI * 2 ** 2) / 4;
    expect(area).toBeGreaterThan(quarterDisc * 0.85);
    expect(area).toBeLessThanOrEqual(quarterDisc);
    // And well inside the square it used to be drawn as.
    expect(area).toBeLessThan(2 ** 2 * 0.8);
  });

  it("scales the plan with the Segment", () => {
    const one = deckPlanOf(library.kaykit_platform_quarter_circle_blue!, 1)!;
    const four = deckPlanOf(library.kaykit_platform_quarter_circle_blue!, 4)!;
    expect(areaOf(four) / areaOf(one)).toBeCloseTo(16, 1);
  });

  it("keeps the hole in a holed deck", () => {
    const solid = areaOf(deckPlanOf(library.kaykit_platform_6x6x1_blue!, 1)!);
    const holed = areaOf(deckPlanOf(library.kaykit_platform_hole_6x6x1_blue!, 1)!);
    expect(holed).toBeLessThan(solid);
  });

  // A ramp's highest point is one edge, so "the triangles at the top" is a
  // sliver. Falling back to the rectangle keeps it drawn as it always was.
  it("keeps the rectangle for a ramp, whose top face is not what you walk on", () => {
    expect(deckPlanOf(library.kaykit_platform_slope_6x6x4_blue!, 1)).toBeUndefined();
  });

  it("subdivides a two-triangle top enough to dome and dent", () => {
    const flat = deckPlanOf(library.kaykit_platform_6x6x1_blue!, 1)!;
    expect(flat.indices.length / 3).toBe(2);
    const smooth = smoothDeckPlan(flat);
    expect(smooth.indices.length / 3).toBeGreaterThanOrEqual(400);
    // Subdividing moves nothing: the shape is the same, only finer.
    expect(areaOf(smooth)).toBeCloseTo(areaOf(flat), 3);
  });
});
