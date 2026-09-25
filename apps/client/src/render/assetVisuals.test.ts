import { readFileSync } from "node:fs";
import * as path from "node:path";
import {
  ASSET_MODULE_DEFS,
  loadAssetLibrary,
  MODULE_LIBRARY,
  readAssetModel,
  segmentOrientation,
  type Module,
} from "@dont-fall/shared";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { assetPlacements, buildAssetVisuals, extractVisualRoot, loadAssetVisuals } from "./assetVisuals.js";
import { disposeSceneGraph } from "./disposeSceneGraph.js";

const assetsRoot = path.resolve(import.meta.dirname, "../../../../assets");
const realBytes = (moduleId: string): Uint8Array => new Uint8Array(readFileSync(path.join(assetsRoot, `${moduleId}.glb`)));
const realFetch = async (url: string): Promise<Uint8Array> =>
  realBytes(url.substring(url.lastIndexOf("/") + 1, url.lastIndexOf(".glb")));

// Off the registry, like the builder twin — a hardcoded four drifted silently
// the moment the M9 block set landed, and would again with every drop.
const ASSET_IDS = ASSET_MODULE_DEFS.map((def) => def.id);

const assetLibrary = async (): Promise<Record<string, Module>> => ({
  ...MODULE_LIBRARY,
  ...(await loadAssetLibrary(realFetch, "http://assets.test")),
});

/** Whether `object` is, or sits under, a render-only effect (ADR 0126) — drawn, but no part of the shared reader's visual half. */
const isEffect = (object: THREE.Object3D | null): boolean =>
  object !== null && (object.userData.role === "effect" || isEffect(object.parent));

/** Every mesh vertex in world space, sorted — comparable against the shared reader's baked positions. */
const worldPositions = (root: THREE.Object3D): [number, number, number][] => {
  root.updateMatrixWorld(true);
  const points: [number, number, number][] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || isEffect(mesh)) return;
    const attribute = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const vertex = new THREE.Vector3();
    for (let i = 0; i < attribute.count; i += 1) {
      vertex.fromBufferAttribute(attribute, i).applyMatrix4(mesh.matrixWorld);
      points.push([vertex.x, vertex.y, vertex.z]);
    }
  });
  return points.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
};

const meshCount = (root: THREE.Object3D): number => {
  let count = 0;
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) count += 1;
  });
  return count;
};

const rolesPresent = (root: THREE.Object3D): unknown[] => {
  const roles: unknown[] = [];
  root.traverse((object) => {
    if (object.userData.role !== undefined) roles.push(object.userData.role);
  });
  return roles;
};

describe("loadAssetVisuals", () => {
  it("fetches one URL per module, derived from the id — the same pipe as collision", async () => {
    const seen: string[] = [];
    await loadAssetVisuals(async (url) => {
      seen.push(url);
      return realFetch(url);
    }, "http://assets.test", ASSET_IDS);

    expect(seen.sort()).toEqual(ASSET_IDS.map((id) => `http://assets.test/${id}.glb`).sort());
  });

  it.each(ASSET_IDS)("keeps %s's visual mesh and drops its collision geometry", async (moduleId) => {
    const templates = await loadAssetVisuals(realFetch, "http://assets.test", [moduleId]);
    const template = templates[moduleId]!;

    // No collision role anywhere in what will be rendered …
    expect(rolesPresent(template)).not.toContain("collision");
    expect(meshCount(template)).toBeGreaterThan(0);
    // … and what remains is exactly the shared reader's visual mesh: the two
    // loaders parse the same file twice with different code, so they must
    // agree triangle-for-triangle.
    const shared = readAssetModel(realBytes(moduleId));
    const expected = shared.visual
      .flatMap((mesh) => mesh.positions.map((p) => [p.x, p.y, p.z] as [number, number, number]))
      .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    expect(worldPositions(template)).toEqual(expected);
  });

  it("names the module when its fetch fails", async () => {
    await expect(
      loadAssetVisuals(async (url) => {
        if (url.endsWith("kaykit_arch_blue.glb")) throw new Error("GET answered 404");
        return realFetch(url);
      }, "http://assets.test", ASSET_IDS),
    ).rejects.toThrow(/kaykit_arch_blue/);
  });
});

describe("extractVisualRoot", () => {
  it("detaches collision nodes instead of hiding them — nothing kept invisible", async () => {
    const templates = await loadAssetVisuals(realFetch, "http://assets.test", ["kaykit_floor_wood_2x2"]);
    const template = templates["kaykit_floor_wood_2x2"]!;

    const hidden: THREE.Object3D[] = [];
    template.traverse((object) => {
      if (!object.visible) hidden.push(object);
    });
    expect(hidden).toEqual([]);
    // Two meshed nodes in the file, exactly one survives the filter.
    expect(meshCount(template)).toBe(1);
  });

  it("fails loudly when a file keeps no visual mesh", () => {
    const scene = new THREE.Group();
    const collision = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    collision.userData.role = "collision";
    scene.add(collision);

    expect(() => extractVisualRoot(scene)).toThrow(/no visual mesh/);
  });

  it("drops a nested collision subtree and keeps its visual siblings", () => {
    const scene = new THREE.Group();
    const parent = new THREE.Group();
    const collision = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    collision.userData.role = "collision";
    const visual = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    visual.userData.role = "visual";
    parent.add(collision);
    scene.add(parent, visual);

    const root = extractVisualRoot(scene);

    expect(rolesPresent(root)).not.toContain("collision");
    expect(meshCount(root)).toBe(1);
    expect(collision.parent).toBeNull();
  });
});

describe("assetPlacements", () => {
  it("places one visual per asset Segment at the Segment's own origin and orientation", async () => {
    const library = await assetLibrary();
    const track = [
      { moduleId: "kaykit_floor_wood_2x2", position: { x: 10, y: 1, z: -3 }, rotation: Math.PI / 2, pitch: 0.1 },
      { moduleId: "kaykit_floor_wood_2x2", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
    ];

    const placements = assetPlacements(track, library);

    expect(placements).toHaveLength(2);
    expect(placements[0]!.moduleId).toBe("kaykit_floor_wood_2x2");
    expect(placements[0]!.position).toEqual({ x: 10, y: 1, z: -3 });
    // The same shared orientation `resolveTrack` rotates collision by — the
    // visual and the trimesh must never be positioned by separate code.
    expect(placements[0]!.orientation).toEqual(segmentOrientation(track[0]!));
    expect(placements[1]!.orientation).toEqual(segmentOrientation(track[1]!));
  });

  it("skips procedural Segments — only asset Segments place visuals", async () => {
    const library = await assetLibrary();
    const proceduralId = Object.keys(MODULE_LIBRARY)[0]!;
    const track = [
      { moduleId: proceduralId, position: { x: 0, y: 0, z: 0 }, rotation: 0 },
      { moduleId: "kaykit_arch_blue", position: { x: 0, y: 0, z: -4 }, rotation: 0 },
    ];

    const placements = assetPlacements(track, library);

    expect(placements.map((p) => p.moduleId)).toEqual(["kaykit_arch_blue"]);
  });

  it("places an Asset that moves a Part of itself, and names the Part drawn elsewhere (ADR 0116)", async () => {
    const library = await assetLibrary();
    const track = [{ moduleId: "sweeper_2arms", position: { x: 0, y: 0, z: 0 }, rotation: 0 }];

    const placements = assetPlacements(track, library);

    // The base stands here; the rotor is posed by its own Moving Segment
    // group, so this instance must leave it out.
    expect(placements).toHaveLength(1);
    expect(placements[0]!.movingParts).toEqual(["rotor"]);
  });

  it("draws only the still Parts of one, so nothing is drawn twice", async () => {
    const library = await assetLibrary();
    const templates = await loadAssetVisuals(realFetch, "http://assets.test", ["sweeper_2arms"]);
    const placements = assetPlacements([{ moduleId: "sweeper_2arms", position: { x: 0, y: 0, z: 0 }, rotation: 0 }], library);

    const visuals = buildAssetVisuals(templates, placements);

    const parts = new Set<string>();
    visuals.traverse((node) => {
      if ((node as THREE.Mesh).isMesh && typeof node.userData.part === "string") parts.add(node.userData.part as string);
    });
    expect([...parts]).toEqual(["base"]);
  });
});

describe("buildAssetVisuals", () => {
  it("clones one transformed instance per placement without touching the template", async () => {
    const templates = await loadAssetVisuals(realFetch, "http://assets.test", ["kaykit_floor_wood_2x2"]);
    const templateMeshCount = meshCount(templates["kaykit_floor_wood_2x2"]!);
    const placements = [
      {
        moduleId: "kaykit_floor_wood_2x2",
        segmentIndex: 0,
        position: { x: 10, y: 1, z: -3 },
        orientation: segmentOrientation({ rotation: Math.PI / 2, pitch: 0.1 }),
      },
      {
        moduleId: "kaykit_floor_wood_2x2",
        segmentIndex: 1,
        position: { x: 0, y: 0, z: 0 },
        orientation: segmentOrientation({ rotation: 0 }),
      },
    ];

    const group = buildAssetVisuals(templates, placements);

    expect(group.children).toHaveLength(2);
    expect(group.children[0]!.position.toArray()).toEqual([10, 1, -3]);
    const q = placements[0]!.orientation;
    expect(group.children[0]!.quaternion.toArray()).toEqual([q.x, q.y, q.z, q.w]);
    // Clones share the template's geometry — four templates cover a Track of
    // any length with no per-Segment upload.
    const templateMesh = templates["kaykit_floor_wood_2x2"]!.children.flatMap((c) =>
      c instanceof THREE.Mesh ? [c] : [],
    )[0]!;
    const instanceMeshes: THREE.Mesh[] = [];
    group.children[0]!.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) instanceMeshes.push(o as THREE.Mesh);
    });
    expect(instanceMeshes.length).toBeGreaterThan(0);
    for (const mesh of instanceMeshes) expect(mesh.geometry).toBe(templateMesh.geometry);
    // The template itself is untouched — still unparented, still whole.
    expect(templates["kaykit_floor_wood_2x2"]!.parent).toBeNull();
    expect(meshCount(templates["kaykit_floor_wood_2x2"]!)).toBe(templateMeshCount);
  });

  it("fails loudly on a placement with no loaded template", () => {
    expect(() =>
      buildAssetVisuals({}, [
        { moduleId: "kaykit_floor_wood_2x2", segmentIndex: 0, position: { x: 0, y: 0, z: 0 }, orientation: segmentOrientation({ rotation: 0 }) },
      ]),
    ).toThrow(/kaykit_floor_wood_2x2/);
  });

  it("removing a Segment removes its mesh, and a Track reload frees them all", async () => {
    const templates = await loadAssetVisuals(realFetch, "http://assets.test", ["kaykit_floor_wood_2x2"]);
    const placements = [0, 1].map((i) => ({
      moduleId: "kaykit_floor_wood_2x2",
      segmentIndex: i,
      position: { x: i * 4, y: 0, z: 0 },
      orientation: segmentOrientation({ rotation: 0 }),
    }));
    const group = buildAssetVisuals(templates, placements);

    // One Segment out: its mesh leaves the scene and is disposed, the other stays.
    const [removed] = group.children.splice(0, 1);
    group.remove(removed!);
    disposeSceneGraph(removed!);
    expect(group.children).toHaveLength(1);
    expect(meshCount(group)).toBe(1);

    // Whole Track out (M4 ticket 01's discipline — the stage's own dispose
    // runs this same sweep-then-clear over the scene holding this group):
    // nothing visual remains, while the cached template survives for the
    // next Track.
    disposeSceneGraph(group);
    group.clear();
    expect(group.children).toHaveLength(0);
    expect(meshCount(templates["kaykit_floor_wood_2x2"]!)).toBe(1);
  });
});

describe("a painted asset Segment", () => {
  // Synthetic: what is under test is the paint reaching the instance, not GLB parsing.
  const piece = {
    id: "piece",
    statics: [],
    asset: { meshes: [] },
    sockets: [],
    footprint: { bounds: { center: { x: 0, y: 0.5, z: 0 }, halfExtents: { x: 1, y: 0.5, z: 1 } }, clearance: 0.5 },
  };
  const redTemplate = (): THREE.Group => {
    const map = new THREE.DataTexture(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1);
    map.needsUpdate = true;
    const template = new THREE.Group();
    template.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map })));
    return template;
  };
  const mapOf = (instance: THREE.Object3D): THREE.DataTexture =>
    (((instance as THREE.Group).children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial)
      .map as THREE.DataTexture;

  it("carries the paint onto its placement, and says nothing of paint when bare", () => {
    const placements = assetPlacements(
      [
        { moduleId: "piece", position: { x: 0, y: 0, z: 0 }, rotation: 0, color: "pink" },
        { moduleId: "piece", position: { x: 5, y: 0, z: 0 }, rotation: 0 },
      ],
      { piece },
    );
    expect(placements[0]!.color).toBe("pink");
    expect(placements[1]).not.toHaveProperty("color");
  });

  it("draws a painted placement tinted flat, bare ones from the file", () => {
    const template = redTemplate();
    const group = buildAssetVisuals(
      { piece: template },
      [
        { moduleId: "piece", segmentIndex: 0, position: { x: 0, y: 0, z: 0 }, orientation: segmentOrientation({ rotation: 0 }), color: "blue" },
        { moduleId: "piece", segmentIndex: 1, position: { x: 4, y: 0, z: 0 }, orientation: segmentOrientation({ rotation: 0 }) },
      ],
    );
    // "piece" is a lone look, so even an authored hue tints (nothing to wear).
    const material = ((group.children[0] as THREE.Group).children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(material.map).toBeNull();
    expect(material.color.getHex()).toBe(new THREE.Color().setHSL(220 / 360, 0.55, 0.55).getHex());
    expect(mapOf(group.children[1]!)).toBe(mapOf(template));
  });
});

describe("a scaled asset Segment (ADR 0062)", () => {
  // Synthetic: what is under test is the scale reaching the instance, not GLB parsing.
  const piece = {
    id: "piece",
    statics: [],
    asset: { meshes: [] },
    sockets: [],
    footprint: { bounds: { center: { x: 0, y: 0.5, z: 0 }, halfExtents: { x: 1, y: 0.5, z: 1 } }, clearance: 0.5 },
  };

  it("places the visual at the Segment's scale, and says nothing of scale at 1×", () => {
    const placements = assetPlacements(
      [
        { moduleId: "piece", position: { x: 0, y: 0, z: 0 }, rotation: 0, scale: 2 },
        { moduleId: "piece", position: { x: 5, y: 0, z: 0 }, rotation: 0 },
      ],
      { piece },
    );
    expect(placements[0]!.scale).toBe(2);
    expect(placements[1]).not.toHaveProperty("scale");

    const template = new THREE.Group();
    template.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
    const group = buildAssetVisuals({ piece: template }, placements);
    expect(group.children[0]!.scale.toArray()).toEqual([2, 2, 2]);
    expect(group.children[1]!.scale.toArray()).toEqual([1, 1, 1]);
  });
});
