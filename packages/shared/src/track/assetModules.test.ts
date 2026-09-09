import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { Module } from "./Module.js";
import { chainTrack, resolveTrack, segmentOrientation, trackSpawn, type Segment, type Track } from "./Track.js";
import {
  ASSET_DEMO_TRACK,
  ASSET_DEMO_TRACK_ID,
  ASSET_MODULE_DEFS,
  assetFileName,
  attachAssetGeometry,
  loadAssetLibrary,
} from "./assetModules.js";
import { addVec3, rotateVec3ByQuat, type Vec3 } from "../math/vec3.js";
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
    // A true L since ticket 04's remodel (measured, not assumed): the exit
    // turns 90° onto the north end (faces +Z) instead of continuing straight.
    expect(byId["corner_lshape"]!.footprint.bounds).toEqual({
      center: { x: 2, y: 0, z: 2 },
      halfExtents: { x: 4, y: 0.5, z: 4 },
    });
    expect(byId["corner_lshape"]!.sockets).toEqual([
      { id: "entry", type: "floor", position: { x: -2, y: 0.5, z: 0 }, yaw: Math.PI / 2 },
      { id: "exit", type: "floor", position: { x: 4, y: 0.5, z: 6 }, yaw: Math.PI },
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

  it("corner_lshape turns a walker 90°: in the west arm, out the north arm", async () => {
    // A true L since ticket 04's remodel — walking straight along the old
    // slab axis would stride off the west-east arm's end (x = 6 is only deck
    // for z in [-2, 2], and the exit sits at z = 6). Turn at the elbow like
    // a player would.
    const sim = clientWorld(await assetLibrary(), [{ moduleId: "corner_lshape", position: { x: 0, y: 0, z: 0 }, rotation: 0 }], {
      x: -1,
      y: 2,
      z: 0,
    });
    const NORTH_OF_CORNER = { ...IDLE_INPUTS, moveDirection: { x: 0, y: 0, z: 1 } };
    for (let n = 0; n < Math.round(20 * TICK_RATE_HZ); n += 1) {
      const c = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
      sim.tick({ [DEFAULT_CHARACTER_ID]: c.position.x < 3.5 ? EAST : NORTH_OF_CORNER });
      const after = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
      if (after.position.z > 5) break;
    }

    const c = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
    expect(c.fallCount).toBe(0);
    expect(c.position.z).toBeGreaterThan(5);
    expect(c.position.y).toBeCloseTo(0.5 + CAPSULE_BOTTOM_OFFSET, 1);
    expect(c.grounded).toBe(true);
    sim.dispose();
  });

  it("the L's missing quadrant is void — walking it falls", async () => {
    // The other side of the remodel proof: the x in [-2, 2], z in [2, 6]
    // quadrant is genuinely empty, not an invisible deck. Marching into it
    // must fall, which is also what makes the turn above a real turn.
    const sim = clientWorld(await assetLibrary(), [{ moduleId: "corner_lshape", position: { x: 0, y: 0, z: 0 }, rotation: 0 }], {
      x: 0,
      y: 2,
      z: 0,
    });
    const NORTH_OF_CORNER = { ...IDLE_INPUTS, moveDirection: { x: 0, y: 0, z: 1 } };
    for (let n = 0; n < Math.round(10 * TICK_RATE_HZ); n += 1) {
      sim.tick({ [DEFAULT_CHARACTER_ID]: NORTH_OF_CORNER });
      if (sim.snapshot().characters[DEFAULT_CHARACTER_ID]!.fallCount > 0) break;
    }

    const c = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
    expect(c.fallCount).toBeGreaterThan(0);
    sim.dispose();
  });
});

describe("loadAssetLibrary warnings (M8 ticket 03)", () => {
  // --- Minimal GLB assembler: a trimmed twin of asset.test.ts's own ---
  // Only what warning-forwarding needs (two indexed float-VEC3 triangles
  // under role-marked nodes); stride/byte-width/transform variants live
  // with the fuller assembler, not duplicated here.
  const assemblePair = (collisionPositions: number[], visualPositions: number[]): Uint8Array => {
    const bin: number[] = [];
    const bufferViews: { buffer: number; byteOffset: number; byteLength: number }[] = [];
    const accessors: unknown[] = [];
    const pushFloats = (floats: number[]): number => {
      const offset = bin.length;
      const view = new DataView(new ArrayBuffer(floats.length * 4));
      floats.forEach((v, i) => view.setFloat32(i * 4, v, true));
      for (let i = 0; i < view.byteLength; i += 1) bin.push(view.getUint8(i));
      while (bin.length % 4 !== 0) bin.push(0);
      bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: floats.length * 4 });
      return bufferViews.length - 1;
    };
    const prim = (positions: number[]): { attributes: { POSITION: number }; indices: number } => {
      accessors.push({ bufferView: pushFloats(positions), componentType: 5126, count: positions.length / 3, type: "VEC3" });
      const positionAccessor = accessors.length - 1;
      const indexOffset = bin.length;
      const indexView = new DataView(new ArrayBuffer(6));
      for (let i = 0; i < 3; i += 1) indexView.setUint16(i * 2, i, true);
      for (let i = 0; i < 6; i += 1) bin.push(indexView.getUint8(i));
      while (bin.length % 4 !== 0) bin.push(0);
      bufferViews.push({ buffer: 0, byteOffset: indexOffset, byteLength: 6 });
      accessors.push({ bufferView: bufferViews.length - 1, componentType: 5123, count: 3, type: "SCALAR" });
      return { attributes: { POSITION: positionAccessor }, indices: accessors.length - 1 };
    };
    const jsonText = JSON.stringify({
      asset: { version: "2.0" },
      scenes: [{ nodes: [0, 1] }],
      nodes: [
        { name: "col", mesh: 0, extras: { role: "collision" } },
        { name: "vis", mesh: 1, extras: { role: "visual" } },
      ],
      meshes: [{ primitives: [prim(collisionPositions)] }, { primitives: [prim(visualPositions)] }],
      accessors,
      bufferViews,
    });
    const jsonBytes = new TextEncoder().encode(jsonText);
    const jsonPadded = jsonBytes.length + ((4 - (jsonBytes.length % 4)) % 4);
    const total = 12 + 8 + jsonPadded + 8 + bin.length;
    const out = new Uint8Array(total);
    const view = new DataView(out.buffer);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, total, true);
    view.setUint32(12, jsonPadded, true);
    view.setUint32(16, 0x4e4f534a, true);
    out.set(jsonBytes, 20);
    out.fill(0x20, 20 + jsonBytes.length, 20 + jsonPadded);
    view.setUint32(20 + jsonPadded, bin.length, true);
    view.setUint32(20 + jsonPadded + 4, 0x004e4942, true);
    out.set(bin, 20 + jsonPadded + 8);
    return out;
  };

  const TRI = [0, 0, 0, 1, 0, 0, 0, 0, 1];
  const defs = [
    {
      id: "warn_me",
      footprint: {
        bounds: { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 2, y: 2, z: 2 } },
        clearance: 0.5,
      },
      sockets: [],
    },
  ];

  it("forwards each file's validation warnings to onWarning, naming the module", async () => {
    // Collision sits inside the footprint; the visual escapes it by 10 on x
    // (past ASSET_VISUAL_WARN) — a warn, never an error, and the load still
    // succeeds with the entry shaped.
    const bytes = assemblePair(TRI, [10, 0, 0, 11, 0, 0, 10, 0, 1]);
    const calls: [string, string][] = [];
    const library = await loadAssetLibrary(async () => bytes, "http://assets.test", defs, (moduleId, warning) => {
      calls.push([moduleId, warning]);
    });

    expect(library["warn_me"]).toBeDefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe("warn_me");
    expect(calls[0]![1]).toMatch(/visual/i);
  });

  it("stays silent when everything fits — the real files warn nothing", async () => {
    const calls: [string, string][] = [];
    await loadAssetLibrary(realFetch([]), "http://assets.test", undefined, (moduleId, warning) => {
      calls.push([moduleId, warning]);
    });

    expect(calls).toEqual([]);
  });

  it("warns nowhere by default — omitting the handler keeps ticket-02 behavior", async () => {
    const bytes = assemblePair(TRI, [10, 0, 0, 11, 0, 0, 10, 0, 1]);
    const library = await loadAssetLibrary(async () => bytes, "http://assets.test", defs);

    expect(library["warn_me"]).toBeDefined();
  });
});

describe("asset demo track (ticket 04)", () => {
  it("composes all four asset Modules plus a finish piece, chained end to end", () => {
    expect(ASSET_DEMO_TRACK.map((segment) => segment.moduleId)).toEqual([
      "platform_straight",
      "ramp_45",
      "stairs_4step",
      "corner_lshape",
      "finish",
    ]);
    // Every Segment after the first sits exactly on the previous one's exit
    // Socket — chained, not hand-placed (re-chaining from the defs agrees).
    const rechained = chainTrack(
      ASSET_DEMO_TRACK.map((segment) => segment.moduleId),
      {
        ...Object.fromEntries(ASSET_MODULE_DEFS.map((def) => [def.id, attachAssetGeometry(def, loadAssetModule(realBytes(def.id), { footprint: def.footprint.bounds }))])),
        ...M1_MODULES,
      },
      { x: 0, y: 0, z: 10 },
    );
    expect(ASSET_DEMO_TRACK).toEqual(rechained);
  });

  it("walks the whole demo Track and qualifies — the scripted playtest", async () => {
    const library = await assetLibrary();
    const resolved = resolveTrack(library, ASSET_DEMO_TRACK);
    // Raceable by construction: the demo ends on M1's finish piece, since
    // asset Modules carry no Finish Zone of their own.
    expect(resolved.finishZones).toHaveLength(1);

    // The corner's own center is void (the missing quadrant), so its three
    // waypoints stay on deck: entry socket, elbow, north arm, exit socket.
    const corner = ASSET_DEMO_TRACK[3]!;
    const finish = ASSET_DEMO_TRACK[4]!;
    const place = (segment: Segment, local: Vec3): Vec3 =>
      addVec3(rotateVec3ByQuat(local, segmentOrientation(segment)), segment.position);
    const waypoints: Vec3[] = [
      ASSET_DEMO_TRACK[0]!.position,
      ASSET_DEMO_TRACK[1]!.position,
      ASSET_DEMO_TRACK[2]!.position,
      place(corner, { x: -2, y: 0.5, z: 0 }),
      place(corner, { x: 4, y: 0.5, z: 0 }),
      place(corner, { x: 4, y: 0.5, z: 4 }),
      place(finish, { x: 0, y: 0, z: 3 }),
    ];

    const sim = clientWorld(library, ASSET_DEMO_TRACK, trackSpawn(ASSET_DEMO_TRACK, 0));
    let next = 0;
    let sinceProgress = 0;
    for (let n = 0; n < 150 * TICK_RATE_HZ; n += 1) {
      const c = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
      const wp = waypoints[next]!;
      const dx = wp.x - c.position.x;
      const dz = wp.z - c.position.z;
      if (Math.hypot(dx, dz) < 1.3) {
        next += 1;
        sinceProgress = 0;
        if (next === waypoints.length) break;
        continue;
      }
      const len = Math.hypot(dx, dz) || 1;
      sim.tick({ [DEFAULT_CHARACTER_ID]: { ...IDLE_INPUTS, moveDirection: { x: dx / len, y: 0, z: dz / len } } });
      sinceProgress += 1;
      expect(sinceProgress, `stuck walking to waypoint ${next} (${wp.x.toFixed(1)}, ${wp.z.toFixed(1)})`).toBeLessThan(25 * TICK_RATE_HZ);
    }
    expect(next, "reached every deck waypoint").toBe(waypoints.length);

    // From the finish entry, straight into the zone: this is where a Race
    // Qualifies (input locks afterward, so this runs as its own phase).
    const zone = resolved.finishZones[0]!.trigger.center;
    let qualified = false;
    for (let n = 0; n < 30 * TICK_RATE_HZ; n += 1) {
      const c = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
      if (c.finishTick !== null) {
        qualified = true;
        break;
      }
      const dx = zone.x - c.position.x;
      const dz = zone.z - c.position.z;
      const len = Math.hypot(dx, dz) || 1;
      sim.tick({ [DEFAULT_CHARACTER_ID]: { ...IDLE_INPUTS, moveDirection: { x: dx / len, y: 0, z: dz / len } } });
    }

    const c = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
    expect(qualified, "qualified on the finish piece").toBe(true);
    expect(c.fallCount).toBe(0);
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
