import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { Module } from "./Module.js";
import { resolveTrack } from "./resolveTrack.js";
import { chainTrack, type Track } from "./Track.js";
import {
  ASSET_MODULE_DEFS,
  ASSET_PLACEMENT_MODULES,
  assetColorFamilyOf,
  assetFileName,
  attachAssetGeometry,
  authoredPaintFileId,
  loadAssetLibrary,
  visualAssetIdsOf,
  type AssetModuleDef,
} from "./assetModules.js";
import { loadAssetModule, readAssetModel } from "./asset.js";
import { invalidLaunchReason, launchDefFor } from "./Launch.js";
import { pointInBox } from "../math/box.js";
import type { VolumeConfig } from "../simulation/Volume.js";
import { KAYKIT_MODULE_DEFS } from "./kaykitAssetDefs.js";
import { QUARTER_ARC_CENTRES, QUARTER_MODULE_DEFS } from "./quarterAssetDefs.js";
import { TRAP_MODULE_DEFS } from "./trapAssetDefs.js";
import { FAN_MODULE_DEFS } from "./fanAssetDefs.js";
import { M1_MODULES } from "./modules.js";
import { CAPSULE_BOTTOM_OFFSET } from "../tuning/character.js";
import { TICK_RATE_HZ } from "../tuning/clock.js";
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
    // Read off the directory rather than a list copied into this file: a
    // hardcoded list drifts silently the moment an asset drop lands, and
    // this catches BOTH directions — a committed file nobody wired up, and
    // a def pointing at a file that isn't there (which would take down the
    // whole library load, and with it server boot and every Track load).
    const committed = readdirSync(assetsRoot)
      .filter((file) => file.endsWith(".glb"))
      .map((file) => file.slice(0, -".glb".length))
      .sort();

    expect(ASSET_MODULE_DEFS.map((def) => def.id).sort()).toEqual(committed);
    for (const def of ASSET_MODULE_DEFS) expect(assetFileName(def.id)).toBe(`${def.id}.glb`);
  });

  it("seats every asset on the pivot convention: X/Z centred, resting on y = 0", () => {
    // The file's origin is the Segment's position — the builder gizmo and
    // every rotation sit there. A piece left where its pack's shared scene
    // put it drew metres away from its own handle.
    // Footprints are rounded to 1 mm, so centre and half-extent can each be
    // off by half of that.
    const MM = 0.0011;
    for (const def of ASSET_MODULE_DEFS) {
      const { center, halfExtents } = def.footprint.bounds;
      expect(Math.abs(center.x), `${def.id} x`).toBeLessThanOrEqual(MM);
      expect(Math.abs(center.z), `${def.id} z`).toBeLessThanOrEqual(MM);
      expect(Math.abs(center.y - halfExtents.y), `${def.id} base`).toBeLessThanOrEqual(MM);
    }
  });

  it("records where every quarter piece's circle is centred — the point four of them turn about", () => {
    // `disc` builds a ring by turning four pieces about this point, so it has
    // to be the real arc centre: every collision vertex inside the piece's
    // outer radius measured from it, all in the one quadrant it curls into,
    // and the arc reaching out to the footprint's far edge.
    expect(Object.keys(QUARTER_ARC_CENTRES).sort()).toEqual(QUARTER_MODULE_DEFS.map((def) => def.id).sort());
    for (const def of QUARTER_MODULE_DEFS) {
      const arc = QUARTER_ARC_CENTRES[def.id]!;
      const size = def.footprint.bounds.halfExtents.x * 2;
      const points = readAssetModel(realBytes(def.id)).collision.flatMap((mesh) => mesh.positions);
      const radii = points.map((p) => Math.hypot(p.x - arc.x, p.z - arc.z));
      expect(Math.max(...radii), def.id).toBeCloseTo(size, 2);
      expect(points.every((p) => p.x >= arc.x - 1e-3 && p.z >= arc.z - 1e-3), def.id).toBe(true);
    }
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

  it("marks exactly the spring Assets as Springs, with a trigger derived from each one's own footprint", () => {
    const springs = ASSET_MODULE_DEFS.filter((def) => def.launch !== undefined).map((def) => def.id);
    expect(springs.sort()).toEqual([
      "kaykit_spring",
      "kaykit_spring_pad_blue",
      "kaykit_spring_pad_green",
      "kaykit_spring_pad_red",
      "kaykit_spring_pad_yellow",
      "trap_platformspringblue",
      "trap_platformspringgreen",
      "trap_platformspringred",
    ]);

    for (const def of ASSET_MODULE_DEFS) {
      if (!def.launch) continue;
      // Derived, never hand-typed: a re-measured Asset moves its trigger with
      // it, and a re-conversion emits exactly this.
      expect(def.launch, def.id).toEqual(launchDefFor(def.footprint.bounds, def.launch.height));
      expect(invalidLaunchReason({ height: def.launch.height }), def.id).toBeUndefined();

      // The box has to hold a standing Character's capsule *centre* — what the
      // trigger actually tests — not merely sit somewhere above the deck.
      const deckTop = def.footprint.bounds.center.y + def.footprint.bounds.halfExtents.y;
      const standingCentre = deckTop + CAPSULE_BOTTOM_OFFSET;
      expect(pointInBox({ x: 0, y: standingCentre, z: 0 }, def.launch.trigger), def.id).toBe(true);
      expect(def.launch.trigger.center.y - def.launch.trigger.halfExtents.y, def.id).toBeLessThan(standingCentre);

      // …and it must NOT reach up into the air above the piece: a Character
      // whose feet are a capsule's length clear of the deck is still falling
      // toward it, and launching there reads as bouncing off nothing (found
      // live, 2026-09-15).
      const clearOfTheDeck = deckTop + CAPSULE_BOTTOM_OFFSET * 2;
      expect(pointInBox({ x: 0, y: clearOfTheDeck, z: 0 }, def.launch.trigger), def.id).toBe(false);
    }
  });

  it("lists every Spring in the Spring category, and nothing else in it", () => {
    // Both directions: a Spring filed under Platform is lost in 400 platforms,
    // and a Platform filed under Spring promises a launch it hasn't got.
    for (const def of ASSET_MODULE_DEFS) {
      expect(def.category === "spring", def.id).toBe(def.launch !== undefined);
    }
    expect(ASSET_MODULE_DEFS.filter((def) => def.category === "spring")).toHaveLength(8);
  });

  it("lists every Fan in the Fan category, and nothing else in it (ADR 0075)", () => {
    // Both directions, like the Springs above: a Fan filed under Platform
    // hides its field, and a Platform filed under Fan promises air it hasn't got.
    for (const def of ASSET_MODULE_DEFS) {
      expect(def.category === "fan", def.id).toBe(def.volumes !== undefined);
    }
    expect(ASSET_MODULE_DEFS.filter((def) => def.category === "fan")).toHaveLength(1);
  });

  it("documents the authored numbers of the one hand-promoted def", () => {
    // The only hand-written def left: everything else is generated off the
    // converted bytes (kaykitAssetDefs/trapAssetDefs headers say how). Top
    // face at the measured y = 0.5 — KayKit pieces sit ON y = 0, so socket
    // height reads the top, never the half-extent.
    const byId = Object.fromEntries(ASSET_MODULE_DEFS.map((def) => [def.id, def]));
    expect(byId["kaykit_floor_wood_2x2"]!.footprint.bounds).toEqual({
      center: { x: 0, y: 0.25, z: 0 },
      halfExtents: { x: 1, y: 0.25, z: 1 },
    });
    expect(byId["kaykit_floor_wood_2x2"]!.sockets).toEqual([
      { id: "entry", type: "floor", position: { x: 0, y: 0.5, z: 1 }, yaw: Math.PI },
      { id: "exit", type: "floor", position: { x: 0, y: 0.5, z: -1 }, yaw: 0 },
    ]);
  });
});

describe("attachAssetGeometry", () => {
  it("shapes a registry entry: id, empty statics, geometry, sockets, footprint", () => {
    const def = ASSET_MODULE_DEFS.find((d) => d.id === "kaykit_floor_wood_2x2")!;
    const module = attachAssetGeometry(def, loadAssetModule(realBytes(def.id), { footprint: def.footprint.bounds }));

    expect(module.id).toBe("kaykit_floor_wood_2x2");
    expect(module.statics).toEqual([]);
    expect(module.asset!.meshes).toHaveLength(1);
    expect(module.asset!.meshes[0]!.positions.length).toBeGreaterThan(0);
    expect(module.asset!.meshes[0]!.surface).toBe("default");
    expect(module.sockets).toBe(def.sockets);
    expect(module.footprint).toBe(def.footprint);
  });
});

describe("asset Volumes (ADR 0075)", () => {
  // The procedural `updraft` Module's own numbers — the first fan carries
  // exactly this field, only bolted to an asset instead of a grey deck.
  const FAN_VOLUME: VolumeConfig = {
    bounds: { center: { x: 0, y: 3, z: 0 }, halfExtents: { x: 1.5, y: 3, z: 2 } },
    force: { x: 0, y: 40, z: 0 },
    maxInducedSpeed: 10,
    priority: 1,
  };

  it("attachAssetGeometry carries a def's volumes onto its Module, like launch", () => {
    const base = ASSET_MODULE_DEFS.find((d) => d.id === "kaykit_floor_wood_2x2")!;
    const def: AssetModuleDef = { ...base, volumes: [FAN_VOLUME] };
    const module = attachAssetGeometry(def, loadAssetModule(realBytes(def.id), { footprint: def.footprint.bounds }));
    expect(module.volumes).toEqual([FAN_VOLUME]);
  });

  it("a def without volumes carries none — absent, like launch, never an empty array", () => {
    const def = ASSET_MODULE_DEFS.find((d) => d.id === "kaykit_floor_wood_2x2")!;
    const module = attachAssetGeometry(def, loadAssetModule(realBytes(def.id), { footprint: def.footprint.bounds }));
    expect(module.volumes).toBeUndefined();
    expect(ASSET_PLACEMENT_MODULES[def.id]!.volumes).toBeUndefined();
  });

  it("an asset-carried volume resolves into world space like a procedural one's", () => {
    const base = ASSET_MODULE_DEFS.find((d) => d.id === "kaykit_floor_wood_2x2")!;
    const library: Record<string, Module> = {
      [base.id]: attachAssetGeometry(
        { ...base, volumes: [FAN_VOLUME] },
        loadAssetModule(realBytes(base.id), { footprint: base.footprint.bounds }),
      ),
    };
    const track: Track = [{ moduleId: base.id, position: { x: 10, y: 0, z: 0 }, rotation: 0 }];
    const resolved = resolveTrack(library, track);
    expect(resolved.volumes).toHaveLength(1);
    expect(resolved.volumes[0]!.bounds.center).toEqual({ x: 10, y: 3, z: 0 });
    expect(resolved.volumes[0]!.force).toEqual({ x: 0, y: 40, z: 0 });
  });
});

describe("loadAssetLibrary", () => {
  it("fetches one URL per def, derived from the id, and keys entries by id", async () => {
    const seen: string[] = [];
    const library = await loadAssetLibrary(realFetch(seen), "http://assets.test");

    const ids = ASSET_MODULE_DEFS.map((def) => def.id).sort();
    expect(seen.sort()).toEqual(ids.map((id) => `http://assets.test/${id}.glb`));
    expect(Object.keys(library).sort()).toEqual(ids);
  });
});

describe("resolveTrack with asset Modules", () => {
  it("emits world-space trimeshes with resolved surfaces, and no box statics", async () => {
    const library = await assetLibrary();
    const resolved = resolveTrack(library, [{ moduleId: "kaykit_floor_wood_2x2", position: { x: 10, y: 0, z: 0 }, rotation: 0 }]);

    expect(resolved.statics).toEqual([]);
    expect(resolved.staticTrimeshes).toHaveLength(1);
    expect(resolved.staticTrimeshes[0]!.surface).toBe("default");
    // Translated into the world, not left in Module space.
    const xs = resolved.staticTrimeshes[0]!.vertices.map((v) => v.x);
    expect(Math.min(...xs)).toBeCloseTo(9, 5);
    expect(Math.max(...xs)).toBeCloseTo(11, 5);
  });

  it("refuses a Module carrying both statics and asset geometry", async () => {
    const library = await assetLibrary();
    const both = { ...library["kaykit_floor_wood_2x2"]!, statics: [{ center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 1, y: 1, z: 1 } }] };

    expect(() => resolveTrack({ ...library, both: both as Module }, [{ moduleId: "both", position: { x: 0, y: 0, z: 0 }, rotation: 0 }])).toThrow(
      /both/,
    );
  });
});

describe("asset physics (ticket 02 Done-when)", () => {
  it("a Character dropped onto the promoted floor lands at the file's height", async () => {
    const sim = clientWorld(await assetLibrary(), [{ moduleId: "kaykit_floor_wood_2x2", position: { x: 0, y: 0, z: 0 }, rotation: 0 }], {
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

  it("a chained platform seam walks through with no snag", async () => {
    const library = await assetLibrary();
    const track = chainTrack(["kaykit_floor_wood_2x2", "kaykit_floor_wood_2x2"], library, { x: 0, y: 0, z: 0 });
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

  it("converted packs are socketless — free placement until a piece is promoted", () => {
    // Every generated def ships without Sockets (see the convert headers),
    // and so does the hand-authored fan (ADR 0075) — only PROMOTED_SOCKETED
    // in assetModules.ts carries hand-written ones. Read off the def files,
    // never hardcoded — a re-conversion must not silently desync this list.
    const socketless = new Set([
      ...KAYKIT_MODULE_DEFS.map((def) => def.id),
      ...TRAP_MODULE_DEFS.map((def) => def.id),
      ...FAN_MODULE_DEFS.map((def) => def.id),
      ...QUARTER_MODULE_DEFS.map((def) => def.id),
    ]);
    const byId = Object.fromEntries(ASSET_MODULE_DEFS.map((def) => [def.id, def]));

    for (const id of socketless) expect(byId[id]!.sockets, id).toEqual([]);
    // ...and every promoted piece does have both, so chaining can rely on it.
    for (const def of ASSET_MODULE_DEFS) {
      if (socketless.has(def.id)) continue;
      expect(def.sockets.map((socket) => socket.id), def.id).toEqual(["entry", "exit"]);
    }
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
  const defs: AssetModuleDef[] = [
    {
      id: "warn_me",
      category: "scenery",
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

describe("loadAssetLibrary failure", () => {
  it("fails the whole load on the first bad file, naming it", async () => {
    const bad: Record<string, Uint8Array> = {};
    await expect(
      loadAssetLibrary(async (url: string) => {
        if (url.endsWith("kaykit_ball.glb")) return new TextEncoder().encode("not a glb");
        const name = url.substring(url.lastIndexOf("/") + 1, url.lastIndexOf(".glb"));
        bad[name] = realBytes(name);
        return bad[name]!;
      }, "http://assets.test"),
    ).rejects.toThrow(/kaykit_ball/);
  });
});

describe("assetColorFamilyOf — one palette tile per shape, not per file", () => {
  it("groups a complete 4-set by stem and names the _red canonical", () => {
    const ids = new Set(["kaykit_platform_6x6x1_blue", "kaykit_platform_6x6x1_green", "kaykit_platform_6x6x1_red", "kaykit_platform_6x6x1_yellow"]);
    expect(assetColorFamilyOf("kaykit_platform_6x6x1_blue", ids)).toEqual({
      stem: "kaykit_platform_6x6x1",
      color: "blue",
      canonicalId: "kaykit_platform_6x6x1_red",
    });
  });

  it("groups nothing without all four files, and never a bare id", () => {
    const ids = new Set(["kaykit_platform_6x6x1_blue", "kaykit_platform_6x6x1_red", "kaykit_ball"]);
    expect(assetColorFamilyOf("kaykit_platform_6x6x1_blue", ids)).toBeNull();
    expect(assetColorFamilyOf("kaykit_ball", ids)).toBeNull();
    expect(assetColorFamilyOf("no_such_thing_red", ids)).toBeNull();
  });

  it("over the real registry: every legacy-suffixed def groups, and every canonical exists", () => {
    const ids = ASSET_MODULE_DEFS.map((def) => def.id);
    // Quarter blues are lone looks, not families (pinned below) — everything else groups.
    const suffixed = ids.filter(
      (id) => /_(blue|green|red|yellow)$/.test(id) && !id.startsWith("kaykit_platform_quarter_"),
    );
    expect(suffixed.length).toBeGreaterThan(0);
    const stems = new Set<string>();
    for (const id of suffixed) {
      const family = assetColorFamilyOf(id);
      expect(family, id).not.toBeNull();
      stems.add(family!.stem);
      expect(ids, `${family!.canonicalId} exists`).toContain(family!.canonicalId);
    }
    // No partial families: 4 files per stem, exactly.
    expect(suffixed.length).toBe(stems.size * 4);
  });

  it("leaves the quarter pack's lone blues alone", () => {
    expect(assetColorFamilyOf("kaykit_platform_quarter_circle_6x6x1_blue")).toBeNull();
  });
});

describe("authoredPaintFileId + visualAssetIdsOf — authored paint wears its file", () => {
  const RED = "kaykit_platform_6x6x1_red";
  const at = (moduleId: string, color?: "blue" | "orange" | "red"): Track[number] => ({
    moduleId,
    position: { x: 0, y: 0, z: 0 },
    rotation: 0,
    ...(color === undefined ? {} : { color }),
  });

  it("names the authored file for an authored hue, null for a flat-tinted one", () => {
    expect(authoredPaintFileId(RED, "blue")).toBe("kaykit_platform_6x6x1_blue");
    expect(authoredPaintFileId(RED, "red")).toBe(RED);
    expect(authoredPaintFileId("kaykit_platform_6x6x1_blue", "yellow")).toBe("kaykit_platform_6x6x1_yellow");
    expect(authoredPaintFileId(RED, "orange")).toBeNull();
    expect(authoredPaintFileId(RED, "purple")).toBeNull();
    expect(authoredPaintFileId("kaykit_ball", "blue")).toBeNull();
  });

  it("adds paint files after placed ones, each once, and never for flat tints", () => {
    expect(visualAssetIdsOf([at(RED, "blue"), at("kaykit_ball"), at(RED, "blue")])).toEqual([
      RED,
      "kaykit_ball",
      "kaykit_platform_6x6x1_blue",
    ]);
    // A flat tint needs no file — the canonical it tints is already listed.
    expect(visualAssetIdsOf([at(RED, "orange")])).toEqual([RED]);
    // Red on the canonical is the identity — listed once, as placed.
    expect(visualAssetIdsOf([at(RED, "red")])).toEqual([RED]);
    // Unpainted tracks load exactly what they place, as before.
    expect(visualAssetIdsOf([at(RED), at("kaykit_ball")])).toEqual([RED, "kaykit_ball"]);
  });
});
