import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { initPhysics, RapierSimulation } from "../simulation/RapierSimulation.js";
import { IDLE_INPUTS } from "../simulation/SimInputs.js";
import { CAPSULE_BOTTOM_OFFSET } from "../tuning/character.js";
import { TICK_DT, TICK_RATE_HZ } from "../tuning/clock.js";
import { loadAssetModule } from "./asset.js";
import { attachAssetGeometry } from "./assetModules.js";
import { invalidAttachmentReason } from "./Attachment.js";
import { DF_MODULE_DEFS, FRAGILE_BLOCK_LOOKS, FRAGILE_BLOCK_RETURN_SECONDS } from "./dfAssetDefs.js";
import { fragileDefOf, fragileLook, fragileReturnTick, fragileStanding, invalidFragileReason } from "./Fragile.js";
import type { Module } from "./Module.js";
import { resolveTrack } from "./resolveTrack.js";
import type { Segment } from "./Track.js";

const assets = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");

const fragileModule = (): Module => {
  const def = DF_MODULE_DEFS.find((entry) => entry.id === "fragile_block")!;
  return attachAssetGeometry(
    def,
    loadAssetModule(new Uint8Array(readFileSync(join(assets, "fragile_block.glb"))), { footprint: def.footprint.bounds }),
  );
};

const DEF = { entries: FRAGILE_BLOCK_LOOKS, returnSeconds: FRAGILE_BLOCK_RETURN_SECONDS };

describe("what a fragile floor is (ADR 0118)", () => {
  it("wears one look per arrival, and stops being a floor on the last", () => {
    expect([0, 1, 2].map((hits) => fragileStanding(DEF, hits))).toEqual([true, true, true]);
    expect(fragileStanding(DEF, 3)).toBe(false);
    // A broken floor is drawn by nobody, so the looks stop at the last authored one.
    expect([0, 1, 2, 3].map((hits) => fragileLook(DEF, hits))).toEqual([0, 1, 2, 2]);
  });

  it("comes back after its author's delay, or never", () => {
    expect(fragileReturnTick(DEF, undefined, 100)).toBe(100 + Math.round(FRAGILE_BLOCK_RETURN_SECONDS / TICK_DT));
    expect(fragileReturnTick(DEF, { returnSeconds: 2 }, 100)).toBe(100 + Math.round(2 / TICK_DT));
    expect(fragileReturnTick(DEF, { returnSeconds: 0 }, 100)).toBeNull();
    expect(fragileDefOf(DEF, { returnSeconds: 2 })).toEqual({ ...DEF, returnSeconds: 2 });
    expect(fragileDefOf(DEF, undefined)).toBe(DEF);
  });

  it("refuses a timing that is not one, at publish", () => {
    expect(invalidFragileReason({ returnSeconds: 0 })).toBeUndefined();
    expect(invalidFragileReason({ returnSeconds: -1 })).toMatch(/0 \(never\)/);
    expect(invalidFragileReason({ entries: 5 })).toMatch(/no "entries"/);
    expect(invalidAttachmentReason({ fragile: { returnSeconds: "soon" } })).toMatch(/returnSeconds/);
    expect(invalidAttachmentReason({ fragile: { returnSeconds: 3 } })).toBeUndefined();
  });

  it("resolves into a body of its own, because what is baked into the world cannot be switched off", () => {
    const resolved = resolveTrack({ fragile_block: fragileModule() }, [
      { moduleId: "fragile_block", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
    ]);

    expect(resolved.staticTrimeshes).toEqual([]);
    expect(resolved.movingSegments).toHaveLength(1);
    expect(resolved.movingSegments[0]!.fragile).toEqual(DEF);
    expect(resolved.movingSegments[0]!.motion).toEqual({});
  });

  it("takes its author's return delay", () => {
    const resolved = resolveTrack({ fragile_block: fragileModule() }, [
      { moduleId: "fragile_block", position: { x: 0, y: 0, z: 0 }, rotation: 0, fragile: { returnSeconds: 0 } },
    ]);

    expect(resolved.movingSegments[0]!.fragile!.returnSeconds).toBe(0);
  });
});

describe("standing on one", () => {
  const LEDGE: Module = {
    id: "ledge",
    statics: [{ center: { x: -3, y: 0.23, z: 0 }, halfExtents: { x: 0.8, y: 0.23, z: 1.2 } }],
    sockets: [],
    footprint: { bounds: { center: { x: -3, y: 0.23, z: 0 }, halfExtents: { x: 0.8, y: 0.23, z: 1.2 } }, clearance: 0.5 },
  };

  beforeAll(async () => {
    await initPhysics();
  });

  const world = (extra: Partial<Segment> = {}) => {
    const resolved = resolveTrack({ fragile_block: fragileModule(), ledge: LEDGE }, [
      { moduleId: "ledge", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
      { moduleId: "fragile_block", position: { x: 0, y: 0, z: 0 }, rotation: 0, ...extra },
    ]);
    const sim = new RapierSimulation({ ...resolved, withDefaultCharacter: false });
    // The tile's top face is at y = 0.46.
    const standing = 0.46 + CAPSULE_BOTTOM_OFFSET;
    sim.addCharacter("me", { x: 0, y: standing + 0.05, z: 0 });
    const run = (seconds: number): void => {
      for (let n = 0; n < Math.round(seconds * TICK_RATE_HZ); n += 1) sim.tick({});
    };
    /** Hop in place: off the tile and back onto it, which is a fresh arrival. */
    const hop = (): void => {
      for (let n = 0; n < 4; n += 1) sim.tick({ me: { ...IDLE_INPUTS, jumpHeld: true } });
      run(0.9);
    };
    return { sim, run, hop, standing, me: () => sim.snapshot().characters.me! };
  };

  it("holds the first two arrivals and gives way on the third", () => {
    const { sim, run, hop, standing, me } = world();
    run(0.5);
    expect(me().grounded).toBe(true);
    expect(sim.snapshot().fragile).toEqual([{ segmentIndex: 1, hits: 1, returnTick: null }]);

    hop();
    expect(me().grounded).toBe(true);
    expect(sim.snapshot().fragile![0]!.hits).toBe(2);

    // The third arrival takes the floor away under whoever made it.
    hop();
    run(0.3);
    expect(me().position.y).toBeLessThan(standing - 1);
    expect(sim.snapshot().fragile![0]!.hits).toBe(FRAGILE_BLOCK_LOOKS);
    sim.dispose();
  });

  it("costs nothing to stand still on", () => {
    const { sim, run } = world();
    run(4);

    // Four seconds of standing is one arrival, not a hundred and twenty.
    expect(sim.snapshot().fragile).toEqual([{ segmentIndex: 1, hits: 1, returnTick: null }]);
    sim.dispose();
  });

  it("comes back intact after its delay", () => {
    const { sim, run, hop } = world({ fragile: { returnSeconds: 1 } });
    run(0.5);
    hop();
    hop();
    expect(sim.snapshot().fragile![0]!.hits).toBe(FRAGILE_BLOCK_LOOKS);

    run(1.2);
    // Back to a floor. It is not *nothing* to send: the Character that fell
    // through has respawned onto it, which is an arrival like any other.
    const back = sim.snapshot().fragile ?? [];
    expect(back[0]?.hits ?? 0).toBeLessThan(FRAGILE_BLOCK_LOOKS);
    expect(back[0]?.returnTick ?? null).toBeNull();
    sim.dispose();
  });

  it("stays gone for good when its author says so", () => {
    const { sim, run, hop } = world({ fragile: { returnSeconds: 0 } });
    run(0.5);
    hop();
    hop();
    run(8);

    expect(sim.snapshot().fragile).toEqual([{ segmentIndex: 1, hits: FRAGILE_BLOCK_LOOKS, returnTick: null }]);
    sim.dispose();
  });

  it("takes the server's floors, but keeps what it has predicted since", () => {
    const { sim, run } = world();
    run(0.5);
    const tick = sim.snapshot().tick;

    // A snapshot from before this world's own arrival cannot un-break it.
    sim.syncFragileToSnapshot([], 0);
    expect(sim.snapshot().fragile![0]!.hits).toBe(1);

    // One from this Tick or later is the authority — including another
    // Player's arrivals, which only ever arrive this way.
    sim.syncFragileToSnapshot([{ segmentIndex: 1, hits: 2, returnTick: null }], tick);
    expect(sim.snapshot().fragile![0]!.hits).toBe(2);
    sim.dispose();
  });
});
