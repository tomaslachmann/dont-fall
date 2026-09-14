import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Box } from "../math/box.js";
import { ASSET_FOOTPRINT_EPSILON, ASSET_VISUAL_WARN } from "../tuning.js";
import { loadAssetModule, readAssetModel, validateAssetModule } from "./asset.js";

// --- Minimal GLB assembler -------------------------------------------------
// Builds exact-geometry fixtures: no Blender, no checked-in binaries, every
// byte accountable. Layout mirrors what Blender exports (one bufferView per
// attribute, tight packing unless `stride` says otherwise).

const FLOAT = 5126;
const UBYTE = 5121;
const USHORT = 5123;
const UINT = 5125;

interface FixturePrim {
  positions: number[];
  indices?: number[];
  indexType?: number;
  stride?: number;
}

interface FixtureNode {
  name: string;
  role?: string;
  surface?: unknown;
  collisionFlag?: boolean;
  mesh?: number;
  children?: number[];
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  matrix?: number[];
}

const indexByteSize = (type: number): number => (type === UBYTE ? 1 : type === USHORT ? 2 : 4);

const setIndex = (view: DataView, offset: number, type: number, value: number): void => {
  if (type === UBYTE) view.setUint8(offset, value);
  else if (type === USHORT) view.setUint16(offset, value, true);
  else view.setUint32(offset, value, true);
};

const assemble = (nodes: FixtureNode[], meshes: FixturePrim[][], sceneRoots?: number[]): Uint8Array => {
  const bin: number[] = [];
  const bufferViews: unknown[] = [];
  const accessors: unknown[] = [];
  const pushView = (bytes: number[]): number => {
    const offset = bin.length;
    bin.push(...bytes);
    while (bin.length % 4 !== 0) bin.push(0);
    const index = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
    return index;
  };

  const meshJson = meshes.map((prims) => ({
    primitives: prims.map((prim) => {
      const stride = prim.stride ?? 12;
      const posBytes: number[] = [];
      const posView = new DataView(new ArrayBuffer(Math.max(stride * (prim.positions.length / 3), 4)));
      for (let v = 0; v < prim.positions.length / 3; v += 1) {
        posView.setFloat32(v * stride, prim.positions[v * 3]!, true);
        posView.setFloat32(v * stride + 4, prim.positions[v * 3 + 1]!, true);
        posView.setFloat32(v * stride + 8, prim.positions[v * 3 + 2]!, true);
      }
      for (let i = 0; i < posView.byteLength; i += 1) posBytes.push(posView.getUint8(i));
      const posViewIndex = pushView(posBytes);
      if (prim.stride !== undefined && prim.stride !== 12) {
        (bufferViews[posViewIndex] as { byteStride: number }).byteStride = prim.stride;
      }
      const vertexCount = prim.positions.length / 3;
      accessors.push({ bufferView: posViewIndex, componentType: FLOAT, count: vertexCount, type: "VEC3" });
      const primJson: Record<string, unknown> = { attributes: { POSITION: accessors.length - 1 } };
      if (prim.indices !== undefined) {
        const indexType = prim.indexType ?? USHORT;
        const idxView = new DataView(new ArrayBuffer(prim.indices.length * indexByteSize(indexType)));
        prim.indices.forEach((value, i) => setIndex(idxView, i * indexByteSize(indexType), indexType, value));
        const idxBytes: number[] = [];
        for (let i = 0; i < idxView.byteLength; i += 1) idxBytes.push(idxView.getUint8(i));
        const idxViewIndex = pushView(idxBytes);
        accessors.push({ bufferView: idxViewIndex, componentType: indexType, count: prim.indices.length, type: "SCALAR" });
        primJson.indices = accessors.length - 1;
      }
      return primJson;
    }),
  }));

  const nodeJson = nodes.map((node) => {
    const extras: Record<string, unknown> = {};
    if (node.role !== undefined) extras.role = node.role;
    if (node.surface !== undefined) extras.surface = node.surface;
    if (node.collisionFlag !== undefined) extras.collision = node.collisionFlag;
    const json: Record<string, unknown> = { name: node.name };
    if (node.mesh !== undefined) json.mesh = node.mesh;
    if (node.children !== undefined) json.children = node.children;
    if (node.translation !== undefined) json.translation = node.translation;
    if (node.rotation !== undefined) json.rotation = node.rotation;
    if (node.scale !== undefined) json.scale = node.scale;
    if (node.matrix !== undefined) json.matrix = node.matrix;
    if (Object.keys(extras).length > 0) json.extras = extras;
    return json;
  });

  const jsonText = JSON.stringify({
    asset: { version: "2.0" },
    scenes: [{ nodes: sceneRoots ?? nodes.map((_, i) => i) }],
    nodes: nodeJson,
    meshes: meshJson,
    accessors,
    bufferViews,
  });
  const jsonBytes = new TextEncoder().encode(jsonText);
  const jsonPadded = jsonBytes.length + ((4 - (jsonBytes.length % 4)) % 4);
  const total = 12 + 8 + jsonPadded + (bin.length > 0 ? 8 + bin.length : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonPadded, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonPadded);
  if (bin.length > 0) {
    const binStart = 20 + jsonPadded;
    view.setUint32(binStart, bin.length, true);
    view.setUint32(binStart + 4, 0x004e4942, true);
    out.set(bin, binStart + 8);
  }
  return out;
};

const TRI = [0, 0, 0, 1, 0, 0, 0, 0, 1];

const pair = (role: "collision" | "visual", extra?: Partial<FixtureNode>): { nodes: FixtureNode[]; meshes: FixturePrim[][] } => ({
  nodes: [
    { name: `${role}-node`, role, mesh: 0, ...extra },
    { name: "other-node", role: role === "collision" ? "visual" : "collision", mesh: 1 },
  ],
  meshes: [
    [{ positions: TRI, indices: [0, 1, 2] }],
    [{ positions: TRI, indices: [0, 1, 2] }],
  ],
});

const box = (center: [number, number, number], half: [number, number, number]): Box => ({
  center: { x: center[0]!, y: center[1]!, z: center[2]! },
  halfExtents: { x: half[0]!, y: half[1]!, z: half[2]! },
});

describe("readAssetModel", () => {
  it("parses one indexed triangle per role with exact positions and indices", () => {
    const { nodes, meshes } = pair("collision");
    const model = readAssetModel(assemble(nodes, meshes));

    expect(model.collision).toHaveLength(1);
    expect(model.collision[0]!.positions).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    ]);
    expect(model.collision[0]!.indices).toEqual([0, 1, 2]);
    expect(model.visual).toHaveLength(1);
    expect(model.visual[0]!.indices).toEqual([0, 1, 2]);
  });

  it("bakes node translation, rotation and scale into the vertices", () => {
    // 180° about Y maps (x, z) -> (-x, -z) under any handedness convention,
    // so the expectation below is exact rather than convention-dependent.
    const { nodes, meshes } = pair("collision", {
      translation: [10, 0, 5],
      rotation: [0, 1, 0, 0],
      scale: [2, 2, 2],
    });
    const model = readAssetModel(assemble(nodes, meshes));

    expect(model.collision[0]!.positions).toEqual([
      { x: 10, y: 0, z: 5 },
      { x: 8, y: 0, z: 5 },
      { x: 10, y: 0, z: 3 },
    ]);
  });

  it("bakes a literal node matrix and composes parent transforms", () => {
    const nodes: FixtureNode[] = [
      { name: "root", translation: [0, 10, 0], children: [1] },
      {
        name: "moved",
        role: "collision",
        mesh: 0,
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1],
      },
      { name: "vis", role: "visual", mesh: 1 },
    ];
    const meshes: FixturePrim[][] = [[{ positions: TRI, indices: [0, 1, 2] }], [{ positions: TRI }]];
    const model = readAssetModel(assemble(nodes, meshes, [0, 2]));

    expect(model.collision[0]!.positions[0]).toEqual({ x: 5, y: 16, z: 7 });
  });

  it("generates sequential indices for a non-indexed mesh", () => {
    const { nodes, meshes } = pair("collision");
    meshes[0] = [{ positions: TRI }];
    const model = readAssetModel(assemble(nodes, meshes));

    expect(model.collision[0]!.indices).toEqual([0, 1, 2]);
  });

  it("reads strided positions and unsigned-byte indices", () => {
    const { nodes, meshes } = pair("collision");
    meshes[0] = [{ positions: TRI, indices: [2, 1, 0], indexType: UBYTE, stride: 16 }];
    const model = readAssetModel(assemble(nodes, meshes));

    expect(model.collision[0]!.positions).toHaveLength(3);
    expect(model.collision[0]!.positions[1]).toEqual({ x: 1, y: 0, z: 0 });
    expect(model.collision[0]!.indices).toEqual([2, 1, 0]);
  });

  it("ignores the stray collision flag on a visual node", () => {
    const { nodes, meshes } = pair("visual", { collisionFlag: true });
    const model = readAssetModel(assemble(nodes, meshes));

    expect(model.visual).toHaveLength(1);
    expect(model.collision).toHaveLength(1);
  });

  it("fails loudly on non-GLB input", () => {
    expect(() => readAssetModel(new TextEncoder().encode('{"asset":{}}'))).toThrow(/GLB/);
    expect(() => readAssetModel(new Uint8Array([1, 2, 3]))).toThrow(/GLB/);
  });

  it("fails on a meshed node with no recognized role, but walks through roleless groups", () => {
    const roles = assemble(
      [
        { name: "group", children: [1, 2] },
        { name: "ok", role: "collision", mesh: 0 },
        { name: "vis", role: "visual", mesh: 1 },
      ],
      [[{ positions: TRI }], [{ positions: TRI }]],
      [0],
    );
    expect(readAssetModel(roles).collision).toHaveLength(1);

    const norole = assemble([{ name: "mystery", mesh: 0 }], [[{ positions: TRI }]]);
    expect(() => readAssetModel(norole)).toThrow(/role/);
  });

  describe("the node-name role fallback (M9 asset drop)", () => {
    it("reads the role off the node name when extras.role is absent", () => {
      // Both spellings this asset drop has shipped, one export to the next.
      for (const [collision, visual] of [
        ["Track_Straight_1x1_Collision", "Track_Straight_1x1_Visual"],
        ["CollisionMesh", "VisualMesh"],
        ["collision_mesh", "mesh-visual"],
      ]) {
        const model = readAssetModel(
          assemble(
            [
              { name: collision!, mesh: 0 },
              { name: visual!, mesh: 1 },
            ],
            [[{ positions: TRI }], [{ positions: TRI }]],
          ),
        );
        expect(model.collision, collision).toHaveLength(1);
        expect(model.visual, visual).toHaveLength(1);
      }
    });

    it("matches whole words only — never a substring", () => {
      // "collisions" and "precollision" are not the word "collision": a mesh
      // is in or out of the world, never included on a near-miss.
      for (const name of ["collisions", "precollision", "kollision", "visuals"]) {
        const stray = assemble([{ name, mesh: 0 }], [[{ positions: TRI }]]);
        expect(() => readAssetModel(stray), name).toThrow(/role/);
      }
    });

    it("refuses a name carrying both words, or neither", () => {
      const both = assemble([{ name: "Visual_Collision_Proxy", mesh: 0 }], [[{ positions: TRI }]]);
      expect(() => readAssetModel(both)).toThrow(/role/);

      const neither = assemble([{ name: "mystery", mesh: 0 }], [[{ positions: TRI }]]);
      expect(() => readAssetModel(neither)).toThrow(/role/);
    });

    it("never overrides an explicit extras.role, and never rescues a wrong one", () => {
      // Name says visual, the property says collision — the property wins,
      // so no existing file can change meaning under this fallback.
      const conflicting = assemble(
        [
          { name: "thing_Visual", role: "collision", mesh: 0 },
          { name: "other", role: "visual", mesh: 1 },
        ],
        [[{ positions: TRI }], [{ positions: TRI }]],
      );
      expect(readAssetModel(conflicting).collision).toHaveLength(1);
      expect(readAssetModel(conflicting).visual).toHaveLength(1);

      // A typo'd property is an authoring error worth failing on — falling
      // back to the name here would silently paper over it.
      const typo = assemble([{ name: "thing_Collision", role: "collission" as "collision", mesh: 0 }], [[{ positions: TRI }]]);
      expect(() => readAssetModel(typo)).toThrow(/role/);
    });
  });
});

describe("validateAssetModule", () => {
  const generous = box([0, 0, 0], [10, 10, 10]);

  it("resolves surfaces node-first, then Module default, then built-in default", () => {
    const { nodes, meshes } = pair("collision", { surface: "mud" });
    const model = readAssetModel(assemble(nodes, meshes));

    expect(validateAssetModule(model, { footprint: generous }).collision[0]!.surface).toBe("mud");
    expect(validateAssetModule(model, { footprint: generous, surface: "ice" }).collision[0]!.surface).toBe("mud");

    const p = pair("collision");
    const plain = readAssetModel(assemble(p.nodes, p.meshes));
    expect(validateAssetModule(plain, { footprint: generous, surface: "ice" }).collision[0]!.surface).toBe("ice");
    expect(validateAssetModule(plain, { footprint: generous }).collision[0]!.surface).toBe("default");
  });

  it("rejects an unknown surface id instead of silently playing the default", () => {
    const { nodes, meshes } = pair("collision", { surface: "icee" });
    const model = readAssetModel(assemble(nodes, meshes));

    expect(() => validateAssetModule(model, { footprint: generous })).toThrow(/icee/);
  });

  it("fails when collision escapes the footprint past the epsilon, naming the axis", () => {
    const { nodes, meshes } = pair("collision");
    const model = readAssetModel(assemble(nodes, meshes));

    // Triangle spans x 0..1: half-extent 1 fits exactly, 0.5 does not.
    expect(() => validateAssetModule(model, { footprint: box([0.5, 0, 0.5], [0.5, 1, 0.5]) })).not.toThrow();
    expect(() => validateAssetModule(model, { footprint: box([0.5, 0, 0.5], [0.4, 1, 0.5]) })).toThrow(/x/);
  });

  it("warns rather than fails when the visual escapes collision past its tolerance", () => {
    const nodes: FixtureNode[] = [
      { name: "col", role: "collision", mesh: 0 },
      { name: "vis", role: "visual", mesh: 1, translation: [10, 0, 0] },
    ];
    const meshes: FixturePrim[][] = [[{ positions: TRI }], [{ positions: TRI }]];
    const model = readAssetModel(assemble(nodes, meshes));

    const validated = validateAssetModule(model, { footprint: generous });
    expect(validated.warnings).toHaveLength(1);
    expect(validated.warnings[0]).toMatch(/visual/i);
  });

  it("stays silent when everything fits", () => {
    const { nodes, meshes } = pair("collision");
    const model = readAssetModel(assemble(nodes, meshes));

    const validated = validateAssetModule(model, { footprint: generous });
    expect(validated.warnings).toEqual([]);
  });

  it("requires both roles to be present", () => {
    const colOnly = assemble([{ name: "col", role: "collision", mesh: 0 }], [[{ positions: TRI }]]);
    expect(() => validateAssetModule(readAssetModel(colOnly), { footprint: generous })).toThrow(/visual/);
  });
});

describe("the real files in assets/", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");
  const names = ["platform_straight", "ramp_45", "stairs_4step", "corner_lshape"];

  it.each(names)("parses %s: both roles present, indices in range", (name) => {
    const model = readAssetModel(new Uint8Array(readFileSync(join(root, `${name}.glb`))));

    expect(model.collision.length).toBeGreaterThan(0);
    expect(model.visual.length).toBeGreaterThan(0);
    for (const mesh of [...model.collision, ...model.visual]) {
      expect(mesh.positions.length).toBeGreaterThan(0);
      for (const index of mesh.indices) expect(index).toBeLessThan(mesh.positions.length);
    }
  });

  it.each(names)("validates %s against its own collision bounds with default surfaces", (name) => {
    const model = readAssetModel(new Uint8Array(readFileSync(join(root, `${name}.glb`))));
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const mesh of model.collision) {
      for (const p of mesh.positions) {
        min.x = Math.min(min.x, p.x);
        min.y = Math.min(min.y, p.y);
        min.z = Math.min(min.z, p.z);
        max.x = Math.max(max.x, p.x);
        max.y = Math.max(max.y, p.y);
        max.z = Math.max(max.z, p.z);
      }
    }
    const footprint = box(
      [(min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2],
      [(max.x - min.x) / 2, (max.y - min.y) / 2, (max.z - min.z) / 2],
    );

    const validated = validateAssetModule(model, { footprint });
    expect(validated.collision.every((mesh) => mesh.surface === "default")).toBe(true);
    expect(validated.warnings).toEqual([]);
  });
});

describe("the three.js boundary", () => {
  it("keeps three.js out of the shared package's dependencies", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty("three");
  });
});

describe("loadAssetModule", () => {
  it("parses and validates in one call", () => {
    const { nodes, meshes } = pair("collision");
    const validated = loadAssetModule(assemble(nodes, meshes), { footprint: box([0, 0, 0], [10, 10, 10]) });

    expect(validated.collision).toHaveLength(1);
    expect(validated.warnings).toEqual([]);
  });
});
