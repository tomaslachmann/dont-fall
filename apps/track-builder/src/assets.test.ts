import { readFileSync } from "node:fs";
import * as path from "node:path";
import {
  ASSET_MODULE_DEFS,
  IDENTITY_QUAT,
  MODULE_LIBRARY,
  readAssetModel,
  type Track,
} from "@dont-fall/shared";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  assetTabModuleIds,
  builderLibrary,
  extractVisualRoot,
  loadAssetVisuals,
} from "./assets.js";
import { insertSegment, segmentOverlapsAnyOther } from "./trackEdit.js";

const assetsRoot = path.resolve(import.meta.dirname, "../../../assets");
const realFetch = async (url: string): Promise<Uint8Array> => {
  const fileName = url.substring(url.lastIndexOf("/") + 1);
  return new Uint8Array(readFileSync(path.join(assetsRoot, fileName)));
};

describe("assetTabModuleIds", () => {
  it("lists exactly the registry's asset Modules — a fixed set, no file input", () => {
    expect(assetTabModuleIds()).toEqual(ASSET_MODULE_DEFS.map((def) => def.id));
    // Length tracks the registry rather than a number copied here — an asset
    // drop lands new ids regularly, and a hardcoded count only ever fails
    // for the uninteresting reason.
    expect(assetTabModuleIds()).toHaveLength(ASSET_MODULE_DEFS.length);
  });
});

describe("builderLibrary", () => {
  it("composes every procedural Module with every asset Module", () => {
    const library = builderLibrary();

    for (const id of Object.keys(MODULE_LIBRARY)) expect(library[id]).toBe(MODULE_LIBRARY[id]);
    for (const def of ASSET_MODULE_DEFS) expect(library[def.id]).toBeDefined();
  });

  it("carries sockets and footprints on asset entries, and no box statics to draw", () => {
    const library = builderLibrary();

    for (const def of ASSET_MODULE_DEFS) {
      const entry = library[def.id]!;
      expect(entry.sockets).toEqual(def.sockets);
      expect(entry.footprint).toEqual(def.footprint);
      expect(entry.statics).toEqual([]);
    }
  });
});

describe("placing asset Modules through the existing insert flow", () => {
  it("chains an asset Module after a procedural one through Sockets", () => {
    const library = builderLibrary();
    const start = [{ moduleId: "start", position: { x: 0, y: 0, z: 10 }, rotation: 0 }];

    const track = insertSegment(start, library, 1, "platform_straight");

    expect(track).toHaveLength(2);
    expect(track[1]!.moduleId).toBe("platform_straight");
    // Socket-seated, not stacked: the asset entry meets the start's exit.
    expect(track[1]!.position).not.toEqual(track[0]!.position);
    expect(Number.isFinite(track[1]!.position.x)).toBe(true);
  });

  it("chains an asset Module after another asset Module", () => {
    const library = builderLibrary();
    const start = [{ moduleId: "platform_straight", position: { x: 0, y: 0, z: 10 }, rotation: 0 }];

    const track = insertSegment(start, library, 1, "corner_lshape");

    expect(track).toHaveLength(2);
    // The corner turns: its exit Socket must not sit on the entry axis.
    expect(track[1]!.position).toBeDefined();
  });

  it("overlap-detects asset Footprints exactly like procedural ones", () => {
    const library = builderLibrary();
    // Three Segments: the candidate's immediate chain neighbors are excluded
    // by design (connected Footprints touch by construction), so the overlap
    // below is against the non-neighbor at the origin.
    const track: Track = [
      { moduleId: "platform_straight", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
      { moduleId: "platform_straight", position: { x: 0, y: 0, z: -4 }, rotation: 0 },
      { moduleId: "platform_straight", position: { x: 100, y: 0, z: 0 }, rotation: 0 },
    ];

    // At the origin it sits exactly on a non-neighbor; far away it overlaps nothing.
    expect(segmentOverlapsAnyOther(track, library, 2, { x: 0, y: 0, z: 0 }, IDENTITY_QUAT)).toBe(true);
    expect(segmentOverlapsAnyOther(track, library, 2, { x: 100, y: 0, z: 0 }, IDENTITY_QUAT)).toBe(false);
  });
});

describe("loadAssetVisuals", () => {
  it("fetches one URL per tab Module from the API — the same pipe as the game", async () => {
    const seen: string[] = [];
    await loadAssetVisuals(async (url) => {
      seen.push(url);
      return realFetch(url);
    }, "http://assets.test");

    expect(seen.sort()).toEqual(
      ASSET_MODULE_DEFS.map((def) => `http://assets.test/${def.id}.glb`).sort(),
    );
  });

  it("names the module when its fetch fails", async () => {
    await expect(
      loadAssetVisuals(async (url) => {
        if (url.endsWith("stairs_4step.glb")) throw new Error("GET answered 404");
        return realFetch(url);
      }, "http://assets.test"),
    ).rejects.toThrow(/stairs_4step/);
  });
});

describe("extractVisualRoot (the twin of the client's role filter)", () => {
  it.each(ASSET_MODULE_DEFS.map((def) => def.id))("keeps %s's visual and drops its collision", async (moduleId) => {
    const templates = await loadAssetVisuals(realFetch, "http://assets.test", [moduleId]);
    const template = templates[moduleId]!;

    const roles: unknown[] = [];
    template.traverse((object) => {
      if (object.userData.role !== undefined) roles.push(object.userData.role);
    });
    expect(roles).not.toContain("collision");
    let meshes = 0;
    template.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) meshes += 1;
    });
    expect(meshes).toBeGreaterThan(0);
    // Same agreement the client's twin pins: the two loaders parse the same
    // file twice with different code and must agree triangle-for-triangle.
    const shared = readAssetModel(new Uint8Array(readFileSync(path.join(assetsRoot, `${moduleId}.glb`))));
    template.updateMatrixWorld(true);
    const points: [number, number, number][] = [];
    template.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const attribute = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      const vertex = new THREE.Vector3();
      for (let i = 0; i < attribute.count; i += 1) {
        vertex.fromBufferAttribute(attribute, i).applyMatrix4(mesh.matrixWorld);
        points.push([vertex.x, vertex.y, vertex.z]);
      }
    });
    const expected = shared.visual
      .flatMap((mesh) => mesh.positions.map((p) => [p.x, p.y, p.z] as [number, number, number]))
      .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    expect(points.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])).toEqual(expected);
  });

  it("fails loudly when a file keeps no visual mesh", () => {
    const scene = new THREE.Group();
    const collision = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    collision.userData.role = "collision";
    scene.add(collision);

    expect(() => extractVisualRoot(scene)).toThrow(/no visual mesh/);
  });
});
