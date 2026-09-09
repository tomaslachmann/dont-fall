import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { Module } from "./Module.js";
import { chainTrack, resolveTrack, type Track } from "./Track.js";
import { ASSET_MODULE_DEFS, assetFileName, attachAssetGeometry, loadAssetLibrary } from "./assetModules.js";
import { loadAssetModule, readAssetModel } from "./asset.js";
import { M1_MODULES } from "./modules.js";
import { CAPSULE_BOTTOM_OFFSET, TICK_RATE_HZ } from "../tuning.js";
import { DEFAULT_CHARACTER_ID, RapierSimulation, initPhysics } from "../simulation/RapierSimulation.js";
import { IDLE_INPUTS, type SimInputs } from "../simulation/SimInputs.js";

beforeAll(async () => {
  await initPhysics();
});

const assetsRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");
const realBytes = (moduleId: string): Uint8Array => new Uint8Array(readFileSync(join(assetsRoot, assetFileName(moduleId))));
// A fetch stand-in that serves the real committed files — the URL formation
// is what varies under test, never the bytes.
const realFetch = (seen: string[]) => async (url: string): Promise<Uint8Array> => {
  seen.push(url);
  return realBytes(url.substring(url.lastIndexOf("/") + 1, url.lastIndexOf(".glb")));
};

const NORTH = { ...IDLE_INPUTS, moveDirection: { x: 0, y: 0, z: -1 } };
const EAST = { ...IDLE_INPUTS, moveDirection: { x: 1, y: 0, z: 0 } };

const tick = (sim: RapierSimulation, seconds: number, input: SimInputs = IDLE_INPUTS): void => {
  for (let n = 0; n < Math.round(seconds * TICK_RATE_HZ); n += 1) sim.tick({ [DEFAULT_CHARACTER_ID]: input });
};

/** Step an asset Track world the way the client builds it: resolve, construct, seat. */
const clientWorld = (library: Record<string, Module>, track: Track, spawn: { x: number; y: number; z: number }): RapierSimulation => {
  const resolved = resolveTrack(library, track);
  const sim = new RapierSimulation({ ...resolved, withDefaultCharacter: false, authoritative: false });
  sim.addCharacter(DEFAULT_CHARACTER_ID, spawn);
  return sim;
};

const assetLibrary = async (): Promise<Record<string, Module>> => {
  const seen: string[] = [];
  const assets = await loadAssetLibrary(realFetch(seen), "http://assets.test");
  return { ...M1_MODULES, ...assets };
};

describe("asset module definitions", () => {
  it("names every committed asset, with the filename stem enforced as the id", () => {
    expect(ASSET_MODULE_DEFS.map((def) => def.id).sort()).toEqual([
      "corner_lshape",
      "platform_straight",
      "ramp_45",
      "stairs_4step",
    ]);
    for (const def of ASSET_MODULE_DEFS) expect(assetFileName(def.id)).toBe(`${def.id}.glb`);
  });

  it("measures every footprint and socket off its real file — nothing fits by accident", () => {
    for (const def of ASSET_MODULE_DEFS) {
      // Throws when the authored numbers drift from the file: the footprint
      // and sockets below are measurements, and this is the test that keeps
      // them honest.
      loadAssetModule(realBytes(def.id), {
        footprint: def.footprint.bounds,
        ...(def.surface === undefined ? {} : { surface: def.surface }),
      });
    }
  });

  it("every collision mesh is closed and outward-wound — what ORIENTED assumes", () => {
    // `RapierSimulation` builds asset colliders with `TriMeshFlags.ORIENTED`
    // (pseudo-normals for border contacts), which is correct exactly when
    // winding is consistently outward. Positive signed volume proves both
    // closed and outward per mesh; a future file failing this fails here,
    // not as a mysterious fall-through in-game.
    for (const def of ASSET_MODULE_DEFS) {
      const model = readAssetModel(realBytes(def.id));
      for (const mesh of model.collision) {
        let signed = 0;
        for (let t = 0; t < mesh.indices.length; t += 3) {
          const a = mesh.positions[mesh.indices[t]!]!;
          const b = mesh.positions[mesh.indices[t + 1]!]!;
          const c = mesh.positions[mesh.indices[t + 2]!]!;
          signed += a.x * (b.y * c.z - b.z * c.y) - a.y * (b.x * c.z - b.z * c.x) + a.z * (b.x * c.y - b.y * c.x);
        }
        expect(signed / 6, `${def.id} collision mesh`).toBeGreaterThan(0);
      }
    }
  });

  it("documents the authored numbers", () => {
    const byId = Object.fromEntries(ASSET_MODULE_DEFS.map((def) => [def.id, def]));
    expect(byId["platform_straight"]!.footprint.bounds).toEqual({
      center: { x: 0, y: 0, z: 0 },
      halfExtents: { x: 2, y: 0.5, z: 2 },
    });
    expect(byId["platform_straight"]!.sockets).toEqual([
      { id: "entry", type: "floor", position: { x: 0, y: 0.5, z: 2 }, yaw: Math.PI },
      { id: "exit", type: "floor", position: { x: 0, y: 0.5, z: -2 }, yaw: 0 },
    ]);
    // Descends in the travel direction: the ridge (+2) is the entry, the toe
    // (-2) the exit. A 45° climb is unclimbable (Sliding, ADR 0037), so the
    // reverse seating would be a module nobody can go up.
    expect(byId["ramp_45"]!.sockets).toEqual([
      { id: "entry", type: "floor", position: { x: 0, y: 2, z: 2 }, yaw: Math.PI },
      { id: "exit", type: "floor", position: { x: 0, y: -2, z: -2 }, yaw: 0 },
    ]);
    // Descends in the travel direction (user decision — 0.375 risers are
    // unclimbable with autostep off): entry high, exit low, and the exit at
    // the TRUE low tread (-0.25), not the side-wall tops.
    expect(byId["stairs_4step"]!.sockets).toEqual([
      { id: "entry", type: "floor", position: { x: 0, y: 0.875, z: -2 }, yaw: 0 },
      { id: "exit", type: "floor", position: { x: 0, y: -0.25, z: 2 }, yaw: Math.PI },
    ]);
    // The file is an 8x4 straight slab, not an L (measured, not assumed —
    // a true L remodel is ticket 04's content fix), so it is socketed along
    // its long axis like any straight: entry faces -X, exit faces +X.
    expect(byId["corner_lshape"]!.footprint.bounds).toEqual({
      center: { x: 2, y: 0, z: 0 },
      halfExtents: { x: 4, y: 0.5, z: 2 },
    });
    expect(byId["corner_lshape"]!.sockets).toEqual([
      { id: "entry", type: "floor", position: { x: -2, y: 0.5, z: 0 }, yaw: Math.PI / 2 },
      { id: "exit", type: "floor", position: { x: 6, y: 0.5, z: 0 }, yaw: -Math.PI / 2 },
    ]);
  });
});

describe("attachAssetGeometry", () => {
  it("shapes a registry entry: id, empty statics, geometry, sockets, footprint", () => {
    const def = ASSET_MODULE_DEFS.find((d) => d.id === "platform_straight")!;
    const module = attachAssetGeometry(def, loadAssetModule(realBytes(def.id), { footprint: def.footprint.bounds }));

    expect(module.id).toBe("platform_straight");
    expect(module.statics).toEqual([]);
    expect(module.asset!.meshes).toHaveLength(1);
    expect(module.asset!.meshes[0]!.positions.length).toBeGreaterThan(0);
    expect(module.asset!.meshes[0]!.surface).toBe("default");
    expect(module.sockets).toBe(def.sockets);
    expect(module.footprint).toBe(def.footprint);
  });
});

describe("loadAssetLibrary", () => {
  it("fetches one URL per def, derived from the id, and keys entries by id", async () => {
    const seen: string[] = [];
    const library = await loadAssetLibrary(realFetch(seen), "http://assets.test");

    expect(seen.sort()).toEqual([
      "http://assets.test/corner_lshape.glb",
      "http://assets.test/platform_straight.glb",
      "http://assets.test/ramp_45.glb",
      "http://assets.test/stairs_4step.glb",
    ]);
    expect(Object.keys(library).sort()).toEqual([
      "corner_lshape",
      "platform_straight",
      "ramp_45",
      "stairs_4step",
    ]);
  });
});

describe("resolveTrack with asset Modules", () => {
  it("emits world-space trimeshes with resolved surfaces, and no box statics", async () => {
    const library = await assetLibrary();
    const resolved = resolveTrack(library, [{ moduleId: "platform_straight", position: { x: 10, y: 0, z: 0 }, rotation: 0 }]);

    expect(resolved.statics).toEqual([]);
    expect(resolved.staticTrimeshes).toHaveLength(1);
    expect(resolved.staticTrimeshes[0]!.surface).toBe("default");
    // Translated into the world, not left in Module space.
    const xs = resolved.staticTrimeshes[0]!.vertices.map((v) => v.x);
    expect(Math.min(...xs)).toBeCloseTo(8, 5);
    expect(Math.max(...xs)).toBeCloseTo(12, 5);
  });

  it("refuses a Module carrying both statics and asset geometry", async () => {
    const library = await assetLibrary();
    const both = { ...library["platform_straight"]!, statics: [{ center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 1, y: 1, z: 1 } }] };

    expect(() => resolveTrack({ ...library, both: both as Module }, [{ moduleId: "both", position: { x: 0, y: 0, z: 0 }, rotation: 0 }])).toThrow(
      /both/,
    );
  });
});

describe("asset physics (ticket 02 Done-when)", () => {
  it("a Character dropped onto platform_straight lands at the file's height", async () => {
    const sim = clientWorld(await assetLibrary(), [{ moduleId: "platform_straight", position: { x: 0, y: 0, z: 0 }, rotation: 0 }], {
      x: 0,
      y: 3,
      z: 0,
    });
    tick(sim, 3);

    const c = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
    expect(c.position.y).toBeCloseTo(0.5 + CAPSULE_BOTTOM_OFFSET, 1);
    expect(c.grounded).toBe(true);
    sim.dispose();
  });

  it("ramp_45 carries a walker down without skipping, onto a chained catcher", async () => {
    const library = await assetLibrary();
    // Walked on, not dropped on: the approach deck meets the ridge flush, so
    // no entry impact pollutes the descent. The toe lands exactly on the
    // catcher's deck the same way.
    const track = chainTrack(["platform_straight", "ramp_45", "platform_straight"], library, { x: 0, y: 0, z: 0 });
    const sim = clientWorld(library, track, { x: 0, y: 2, z: 1.5 });
    let grounded = 0;
    let total = 0;
    for (let n = 0; n < Math.round(10 * TICK_RATE_HZ); n += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH });
      const c = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
      total += 1;
      if (c.grounded) grounded += 1;
      if (c.position.z < -7 && c.grounded) break;
    }

    const c = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
    expect(c.fallCount).toBe(0);
    expect(c.position.z).toBeLessThan(-7);
    expect(c.position.y).toBeCloseTo(-3.5 + CAPSULE_BOTTOM_OFFSET, 1);
    expect(grounded / total).toBeGreaterThan(0.7);
    sim.dispose();
  });

  it("stairs_4step descends step by step with no jumping", async () => {
    // Chained, so the entry meets the previous deck flush and the exit lands
    // on a catcher: the whole descent is walked, nothing dropped onto.
    const library = await assetLibrary();
    const track = chainTrack(["platform_straight", "stairs_4step", "platform_straight"], library, { x: 0, y: 0, z: 0 });
    const sim = clientWorld(library, track, { x: 0, y: 2, z: 1.5 });
    let grounded = 0;
    let total = 0;
    for (let n = 0; n < Math.round(12 * TICK_RATE_HZ); n += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH });
      const c = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
      total += 1;
      if (c.grounded) grounded += 1;
      if (c.position.z < -7 && c.grounded) break;
    }

    const c = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
    expect(c.fallCount).toBe(0);
    expect(c.position.z).toBeLessThan(-7);
    expect(c.position.y).toBeCloseTo(-0.625 + CAPSULE_BOTTOM_OFFSET, 1);
    expect(grounded / total).toBeGreaterThan(0.7);
    sim.dispose();
  });

  it("a chained platform seam walks through with no snag", async () => {
    const library = await assetLibrary();
    const track = chainTrack(["platform_straight", "platform_straight"], library, { x: 0, y: 0, z: 0 });
    const sim = clientWorld(library, track, { x: 0, y: 2, z: 1.5 });
    for (let n = 0; n < Math.round(10 * TICK_RATE_HZ); n += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH });
      const c = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
      if (c.position.z < -2.5) break;
    }

    const c = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
    expect(c.fallCount).toBe(0);
    expect(c.position.z).toBeLessThan(-2.5);
    expect(c.grounded).toBe(true);
    expect(c.position.y).toBeCloseTo(0.5 + CAPSULE_BOTTOM_OFFSET, 1);
    sim.dispose();
  });

  it("the corner slab walks end to end along its long axis", async () => {
    const sim = clientWorld(await assetLibrary(), [{ moduleId: "corner_lshape", position: { x: 0, y: 0, z: 0 }, rotation: 0 }], {
      x: -1,
      y: 2,
      z: 0,
    });
    for (let n = 0; n < Math.round(10 * TICK_RATE_HZ); n += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: EAST });
      const c = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
      if (c.position.x > 5) break;
    }

    const c = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
    expect(c.fallCount).toBe(0);
    expect(c.position.x).toBeGreaterThan(5);
    expect(c.position.y).toBeCloseTo(0.5 + CAPSULE_BOTTOM_OFFSET, 1);
    sim.dispose();
  });
});

describe("loadAssetLibrary failure", () => {
  it("fails the whole load on the first bad file, naming it", async () => {
    const bad: Record<string, Uint8Array> = {};
    await expect(
      loadAssetLibrary(async (url: string) => {
        if (url.endsWith("ramp_45.glb")) return new TextEncoder().encode("not a glb");
        const name = url.substring(url.lastIndexOf("/") + 1, url.lastIndexOf(".glb"));
        bad[name] = realBytes(name);
        return bad[name]!;
      }, "http://assets.test"),
    ).rejects.toThrow(/ramp_45/);
  });
});
