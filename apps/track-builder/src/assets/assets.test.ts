// @vitest-environment node
// Node, not the jsdom default: these tests parse real GLBs through
// GLTFLoader, whose texture path needs `URL.createObjectURL` (jsdom lacks
// it — the rejections crash the worker instead of failing the test).
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
  loadAssetVisualsProgressive,
  type AssetVisualResult,
} from "./assets.js";
import { insertSegment, segmentOverlapsAnyOther } from "../track/trackEdit.js";

const assetsRoot = path.resolve(import.meta.dirname, "../../../../assets");
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
  it("is exactly the asset Modules — nothing procedural places (ADR 0078)", () => {
    const library = builderLibrary();

    expect(Object.keys(library).sort()).toEqual(ASSET_MODULE_DEFS.map((def) => def.id).sort());
    for (const id of Object.keys(MODULE_LIBRARY)) expect(library[id]).toBeUndefined();
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
        if (url.endsWith("kaykit_floor_wood_2x2.glb")) throw new Error("GET answered 404");
        return realFetch(url);
      }, "http://assets.test"),
    ).rejects.toThrow(/kaykit_floor_wood_2x2/);
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

import { triangleGlb } from "../test/glb.js";

describe("loadAssetVisualsProgressive", () => {
  it("settles every id exactly once — ready files parse, bad ones name themselves", async () => {
    const glb = triangleGlb();
    const settled = new Map<string, AssetVisualResult>();
    await loadAssetVisualsProgressive(
      async (url) => {
        if (url.endsWith("bad.glb")) return new TextEncoder().encode("not a glb");
        if (url.endsWith("missing.glb")) throw new Error("GET answered 404");
        return glb;
      },
      "http://assets.test",
      ["good", "bad", "missing"],
      (moduleId, result) => {
        // `assetFileName` stems the URL off the id ("good" → "good.glb").
        expect(settled.has(moduleId)).toBe(false);
        settled.set(moduleId, result);
      },
    );

    expect(settled.get("good")).toMatchObject({ ok: true });
    const template = (settled.get("good") as { ok: true; template: THREE.Group }).template;
    let meshes = 0;
    template.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) meshes += 1;
    });
    expect(meshes).toBe(1);
    // One bad file settles the other two — nothing here fails fast.
    expect(settled.get("bad")).toMatchObject({ ok: false });
    expect((settled.get("bad") as { ok: false; error: Error }).error.message).toMatch(/"bad"/);
    expect(settled.get("missing")).toMatchObject({ ok: false });
    expect((settled.get("missing") as { ok: false; error: Error }).error.message).toMatch(/"missing"/);
  });
});
