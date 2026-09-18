/**
 * Shared asset-pack conversion helpers (KayKit, ImageToStl, …): GLB
 * read/write, role-pair node duplication, footprint measurement with the
 * real shared reader, geometry dedup hashing, and def-file emission.
 *
 * Every converter here repackages, never remodels: same mesh bytes in,
 * same mesh bytes out — only the container (external → embedded buffers),
 * node roles, and the registry def change. Textures stay embedded whenever
 * the source has them: the client's `GLTFLoader` applies them in the
 * browser, and the twin tests split textured/untextured files honestly
 * (textured GLBs can't parse in Node — `self.URL` — so their Node-proof is
 * the shared reader + JSON roles, and the browser proves the rest live).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { readAssetModel } from "../packages/shared/src/track/asset.js";
import type { AssetCategory } from "../packages/shared/src/track/assetModules.js";
import type { Hazard } from "../packages/shared/src/track/Module.js";
import { launchDefFor } from "../packages/shared/src/track/Launch.js";

export interface GltfNode {
  mesh?: number;
  name?: string;
  children?: number[];
  translation?: [number, number, number];
  scale?: [number, number, number];
  matrix?: number[];
  extras?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Gltf {
  nodes?: GltfNode[];
  meshes?: { primitives: { material?: unknown; [key: string]: unknown }[] }[];
  buffers?: { byteLength: number; uri?: string }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number }[];
  images?: { uri?: string; mimeType?: string; bufferView?: number; name?: string }[];
  scenes?: { nodes?: number[] }[];
  [key: string]: unknown;
}

const pad4 = (n: number): number => (4 - (n % 4)) % 4;

/** Split GLB bytes into its JSON chunk (parsed) and BIN chunk (raw). */
export const readGlb = (bytes: Uint8Array): { json: Gltf; bin: Buffer } => {
  const data = Buffer.from(bytes);
  if (data.subarray(0, 4).toString() !== "glTF") throw new Error("not a GLB file");
  const jsonLength = data.readUInt32LE(12);
  const json = JSON.parse(data.subarray(20, 20 + jsonLength).toString("utf8")) as Gltf;
  const binStart = 20 + jsonLength + 8;
  const binLength = data.readUInt32LE(20 + jsonLength);
  return { json, bin: data.subarray(binStart, binStart + binLength) };
};

/** Pack JSON + one BIN chunk into GLB bytes (4-byte aligned per spec). */
export const writeGlb = (json: unknown, bin: Buffer): Buffer => {
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const jsonPadded = Buffer.concat([jsonBytes, Buffer.alloc(pad4(jsonBytes.length), 0x20)]);
  const binPadded = Buffer.concat([bin, Buffer.alloc(pad4(bin.length), 0x00)]);
  const total = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
  const glb = Buffer.alloc(total);
  glb.write("glTF", 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(total, 8);
  glb.writeUInt32LE(jsonPadded.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  jsonPadded.copy(glb, 20);
  const cursor = 20 + jsonPadded.length;
  glb.writeUInt32LE(binPadded.length, cursor);
  glb.writeUInt32LE(0x004e4942, cursor + 4);
  binPadded.copy(glb, cursor + 8);
  return glb;
};

/**
 * Duplicate every scene root into a collision + visual subtree over the same
 * meshes (two node entries, zero byte duplication). Group nodes copy plain;
 * meshed role-less nodes gain their subtree's role. Pre-roled subtrees pass
 * through untouched. Returns how many meshed nodes were paired.
 */
export const addRolePairs = (json: Gltf): number => {
  const srcNodes = json.nodes ?? [];
  const outNodes: GltfNode[] = [];
  let paired = 0;
  const copySubtree = (index: number, role: "collision" | "visual"): number => {
    const node = srcNodes[index]!;
    if (node.extras?.role !== undefined) {
      const at = outNodes.length;
      outNodes.push({ ...node, children: undefined });
      const kids = (node.children ?? []).map((child) => copySubtree(child, role));
      if (kids.length > 0) outNodes[at]!.children = kids;
      return at;
    }
    const at = outNodes.length;
    const copy: GltfNode = { ...node };
    delete copy.children;
    if (node.mesh !== undefined) {
      paired += 1;
      copy.name = `${node.name ?? "node"}_${role}`;
      copy.extras = { ...(node.extras ?? {}), role };
    }
    outNodes.push(copy);
    const kids = (node.children ?? []).map((child) => copySubtree(child, role));
    if (kids.length > 0) copy.children = kids;
    return at;
  };
  json.nodes = outNodes;
  for (const scene of json.scenes ?? []) {
    const roots: number[] = [];
    for (const index of scene.nodes ?? []) {
      if (srcNodes[index]!.extras?.role !== undefined) {
        roots.push(copySubtree(index, "collision"));
      } else {
        roots.push(copySubtree(index, "collision"), copySubtree(index, "visual"));
      }
    }
    scene.nodes = roots;
  }
  return paired;
};

/** Embed each URI image 4-aligned into the BIN chunk with its own bufferView. */
export const embedImages = (json: Gltf, dir: string, bin: Buffer): Buffer => {
  (json.bufferViews ??= []);
  const chunks: Buffer[] = [bin];
  let offset = bin.length;
  for (const image of json.images ?? []) {
    if (image.bufferView !== undefined || !image.uri) {
      throw new Error("unexpected pre-embedded image (converters expect URI images)");
    }
    const data = image.uri.startsWith("data:")
      ? Buffer.from(image.uri.split(",")[1]!, "base64")
      : readFileSync(joinDir(dir, image.uri));
    const pad = pad4(offset);
    chunks.push(Buffer.alloc(pad), data);
    offset += pad;
    image.bufferView = json.bufferViews.length;
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length });
    offset += data.length;
    delete image.uri;
  }
  return Buffer.concat(chunks);
};

const joinDir = (dir: string, file: string): string => `${dir}/${file}`;

type Vec3 = { x: number; y: number; z: number };

/** Exact (unrounded) world-space collision min/max, through the real shared reader. */
const collisionExtents = (glb: Buffer): { min: Vec3; max: Vec3 } => {
  const model = readAssetModel(new Uint8Array(glb));
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
  return { min, max };
};

/**
 * Seat a file on the Asset pivot convention — X/Z centred, resting on
 * y = 0 — and scale it uniformly about that pivot. A Segment's position is
 * the file's origin, so it is where the builder's gizmo sits and what a
 * rotation turns about: a pack exported with every piece still at its spot
 * in one shared Blender scene put the gizmo metres (up to 23 m) away from
 * the mesh.
 *
 * Rewrites only the scene roots' transforms, never mesh bytes, so UVs and
 * the authored look are untouched and collision and visual move together.
 * For a root `T(t)·R·S`, `scale·(world − pivot)` is `T(scale·(t − pivot))·
 * R·(scale·S)` — a uniform scale commutes with any rotation — so the
 * rotation stays as authored; a `matrix` root gets the same map applied.
 */
export const seatOnPivot = (json: Gltf, bin: Buffer, scale = 1): void => {
  const { min, max } = collisionExtents(writeGlb(json, bin));
  // Snapped to 0.1 mm: float32 vertices put an already-seated piece's pivot
  // at ~1e-7, and a file needing no move should come out byte-identical.
  const snap = (n: number): number => Math.round(n * 1e4) / 1e4 || 0;
  const pivot: [number, number, number] = [snap((min.x + max.x) / 2), snap(min.y), snap((min.z + max.z) / 2)];
  if (scale === 1 && pivot.every((n) => n === 0)) return;
  const roots = new Set((json.scenes ?? []).flatMap((scene) => scene.nodes ?? []));
  for (const index of roots) {
    const node = json.nodes![index]!;
    if (node.matrix) {
      // Column-major: every column's xyz row becomes s·row − s·pivot·w.
      const m = node.matrix;
      for (let column = 0; column < 4; column += 1) {
        const w = m[column * 4 + 3]!;
        for (let row = 0; row < 3; row += 1) {
          m[column * 4 + row] = scale * (m[column * 4 + row]! - pivot[row]! * w);
        }
      }
      continue;
    }
    const t = node.translation ?? [0, 0, 0];
    node.translation = [scale * (t[0] - pivot[0]), scale * (t[1] - pivot[1]), scale * (t[2] - pivot[2])];
    if (scale !== 1 || node.scale) {
      const s = node.scale ?? [1, 1, 1];
      node.scale = [scale * s[0], scale * s[1], scale * s[2]];
    }
  }
};

/** Collision bounds measured with the real shared reader (never eyeballed). */
export const measureBounds = (glb: Buffer): { center: Vec3; half: Vec3 } => {
  const round3 = (n: number): number => Number(n.toFixed(3)) || 0;
  const { min, max } = collisionExtents(glb);
  return {
    center: { x: round3((min.x + max.x) / 2), y: round3((min.y + max.y) / 2), z: round3((min.z + max.z) / 2) },
    half: { x: round3((max.x - min.x) / 2), y: round3((max.y - min.y) / 2), z: round3((max.z - min.z) / 2) },
  };
};

/**
 * Geometry identity for Blender-style `_001` duplicates: rounded collision
 * positions + index counts hashed. Same hash ⇒ same shape, keep one.
 */
export const geometryHash = (glb: Buffer): string => {
  const model = readAssetModel(new Uint8Array(glb));
  const hash = createHash("sha256");
  for (const mesh of model.collision) {
    hash.update(String(mesh.positions.length));
    for (const p of mesh.positions) {
      hash.update(`${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)};`);
    }
  }
  return hash.digest("hex").slice(0, 16);
};

export interface MeasuredDef {
  id: string;
  category: AssetCategory;
  hazard?: Hazard;
  center: Vec3;
  half: Vec3;
  /** How high this Asset throws, if it is a Spring (ADR 0069) — from the pack's own {@link LaunchRules}. */
  launchHeight?: number;
}

/**
 * A pack's Spring rules (ADR 0069): the first pattern matching an id's stem
 * gives that Asset's default throw, in metres. Unmatched stems are not
 * Springs — unlike categories, a missing match here is the normal case.
 */
export type LaunchRules = [RegExp, number][];

/** The launch height for `stem`, or `undefined` when this Asset is not a Spring. */
export const launchHeightFor = (stem: string, rules: LaunchRules): number | undefined =>
  rules.find(([pattern]) => pattern.test(stem))?.[1];


/**
 * A pack's category rules: the first pattern matching an id's stem wins.
 * An id no rule matches fails the conversion — a new piece in a pack gets a
 * deliberate category, never a silent default.
 */
export type CategoryRules = [pattern: RegExp, category: AssetCategory][];

export const categorize = (id: string, stem: string, rules: CategoryRules): AssetCategory => {
  const rule = rules.find(([pattern]) => pattern.test(stem));
  if (!rule) throw new Error(`${id}: no category rule matches "${stem}" — add one to the converter`);
  return rule[1];
};

/** Emit a generated registry-defs file (socketless, free placement). */
/**
 * A Spring def's `launch` line (ADR 0069), or nothing — derived from the
 * measured footprint by the shared {@link launchDefFor}, never hand-typed, so
 * a re-measured Asset moves its trigger with it.
 */
const launchSource = (def: MeasuredDef): string => {
  if (def.launchHeight === undefined) return "";
  const { trigger, height } = launchDefFor({ center: def.center, halfExtents: def.half }, def.launchHeight);
  return (
    `    launch: {\n      trigger: { center: { x: ${trigger.center.x}, y: ${trigger.center.y}, z: ${trigger.center.z} },` +
    ` halfExtents: { x: ${trigger.halfExtents.x}, y: ${trigger.halfExtents.y}, z: ${trigger.halfExtents.z} } },\n` +
    `      height: ${height},\n    },\n`
  );
};

export const emitDefsFile = (path: string, constName: string, header: string, defs: MeasuredDef[], tail = ""): void => {
  const body = defs
    .map(
      (def) =>
        `  {\n    id: "${def.id}",\n    category: "${def.category}",\n${def.hazard ? `    hazard: "${def.hazard}",\n` : ""}    footprint: {\n      bounds: { center: { x: ${def.center.x}, y: ${def.center.y}, z: ${def.center.z} }, halfExtents: { x: ${def.half.x}, y: ${def.half.y}, z: ${def.half.z} } },\n      clearance: 0.5,\n    },\n    sockets: [],\n${launchSource(def)}  },`,
    )
    .join("\n");
  writeFileSync(
    path,
    `${header}\nimport type { AssetModuleDef } from "./assetModules.js";\n\nexport const ${constName}: AssetModuleDef[] = [\n${body}\n];\n${tail}`,
  );
};
