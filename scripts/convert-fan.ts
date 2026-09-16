/**
 * Fan converter (ADR 0075, amended 2026-09-16): turns a Meshy fan export into
 * `assets/fan.glb`.
 *
 * The drop is one fused, textured mesh (plus Blender's leftover default
 * `Cube`) with no roles, centred on the origin. This script does what the
 * game needs done to it, and nothing to how it looks:
 *
 *   1. SPLIT    Cuts the rotor out of the fused mesh so it can spin on its
 *               own. A triangle whose centroid lies within FAN_ROTOR_RADIUS
 *               of the Y axis and above FAN_ROTOR_ABOVE_Y is rotor, the rest
 *               is housing. The user picked 0.64 after comparing 0.62, 0.64,
 *               0.66 and 0.70 side by side.
 *   2. SIMPLIFY Runs meshoptimizer on each part down to its triangle budget.
 *               Kept vertices keep their own normals and UVs, because
 *               simplifying only drops vertices, it never moves them.
 *               Borders are not locked: a Meshy mesh is full of open edges,
 *               and locking them held the housing at 41k tris whatever the
 *               error bound. Unlocked, a border only collapses along itself,
 *               so nothing opens up, and the rotor's recess edge may shift a
 *               hair.
 *   3. SEAT     Centres X/Z on the pivot and rests the file on y = 0, baked
 *               into the vertices. The rotor is baked about its own axis,
 *               with its node standing on that axis.
 *   4. PROXY    Collision is a closed, outward box around the housing, never
 *               the sculpt, whose open blades would snag capsules.
 *   5. SOLIDS   Adds the ADR 0065 solid parts, fitted off that box.
 *   6. TEXTURES Re-encodes every image at TEXTURE_SIZE. The fan is about two
 *               units across on screen, so 2048² is wasted there. This step
 *               uses macOS `sips`.
 *
 * The rotor node carries `extras.spin` (rad/s about its own +Y). The
 * renderer turns it and the shared reader ignores it, so it never reaches
 * collision (ticket `.scratch/fan/issues/02`).
 *
 * Usage:  pnpm convert:fan                      (assets/Meshy_fan/fan_lower_poly.glb)
 *         pnpm convert:fan path/to/export.glb
 *
 * It prints the footprint for `fanAssetDefs.ts`, which stays hand-authored.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MeshoptSimplifier } from "meshoptimizer";
import { readAssetModel } from "../packages/shared/src/track/asset.js";
import { readGlb, writeGlb, type Gltf } from "./convert-lib.js";
import { addSolidNodes, describeParts } from "./convert-solids.js";

/** Where the rotor ends, measured from the Y axis in the export's own frame. */
export const FAN_ROTOR_RADIUS = 0.64;
/** How high a triangle's centroid must sit, in the export's own frame, to be rotor rather than the motor under it. */
export const FAN_ROTOR_ABOVE_Y = 0.3;
/** How fast the rotor turns (rad/s, about its own +Y). The user's pick, 2026-09-16. */
export const FAN_ROTOR_SPIN = 14;

/**
 * The housing's triangle budget, measured by rendering 18k, 30k, 45k and the
 * untouched 63.5k side by side (2026-09-16). At 18k (the old fan's budget)
 * the bevels go lumpy, the corner studs melt, and the kept normals no longer
 * fit their faces. At 30k it reads as the source does, at 0.2% error.
 */
const HOUSING_TARGET_TRIS = 30000;
const ROTOR_TARGET_TRIS = 2000;
/** meshoptimizer's error bound, relative to the part's extent. The triangle budget binds before this does. */
const SIMPLIFY_ERROR = 0.02;
const TEXTURE_SIZE = 1024;
const JPEG_QUALITY = 85;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = process.argv[2] ?? join(root, "assets", "Meshy_fan", "fan_lower_poly.glb");
const target = join(root, "assets", "fan.glb");

type SourceJson = Gltf & {
  accessors: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string }[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  meshes: { primitives: { attributes: Record<string, number>; indices?: number; material?: number }[] }[];
  materials?: Record<string, unknown>[];
  textures?: { sampler?: number; source?: number }[];
  samplers?: Record<string, unknown>[];
};

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

const readAccessor = (json: SourceJson, bin: Buffer, index: number): Float32Array | Uint32Array => {
  const accessor = json.accessors[index]!;
  const view = json.bufferViews[accessor.bufferView!]!;
  const width = COMPONENTS[accessor.type]!;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const count = accessor.count * width;
  const data = new DataView(bin.buffer, bin.byteOffset);
  if (accessor.componentType === 5126) {
    const stride = view.byteStride ?? width * 4;
    const out = new Float32Array(count);
    for (let i = 0; i < accessor.count; i += 1) {
      for (let c = 0; c < width; c += 1) out[i * width + c] = data.getFloat32(start + i * stride + c * 4, true);
    }
    return out;
  }
  const size = accessor.componentType === 5125 ? 4 : accessor.componentType === 5123 ? 2 : 1;
  const out = new Uint32Array(count);
  for (let i = 0; i < count; i += 1) {
    const at = start + i * size;
    out[i] = size === 4 ? data.getUint32(at, true) : size === 2 ? data.getUint16(at, true) : data.getUint8(at);
  }
  return out;
};

interface Part {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

/** Only the vertices `indices` uses, renumbered in first-use order. */
const compact = (indices: ArrayLike<number>, positions: Float32Array, normals: Float32Array, uvs: Float32Array): Part => {
  const remap = new Map<number, number>();
  const out = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i += 1) {
    const old = indices[i]!;
    let next = remap.get(old);
    if (next === undefined) {
      next = remap.size;
      remap.set(old, next);
    }
    out[i] = next;
  }
  const p = new Float32Array(remap.size * 3);
  const n = new Float32Array(remap.size * 3);
  const t = new Float32Array(remap.size * 2);
  for (const [old, next] of remap) {
    p.set(positions.subarray(old * 3, old * 3 + 3), next * 3);
    n.set(normals.subarray(old * 3, old * 3 + 3), next * 3);
    t.set(uvs.subarray(old * 2, old * 2 + 2), next * 2);
  }
  return { positions: p, normals: n, uvs: t, indices: out };
};

const simplify = (part: Part, targetTris: number): { part: Part; error: number } => {
  if (part.indices.length / 3 <= targetTris) return { part, error: 0 };
  const [indices, error] = MeshoptSimplifier.simplify(part.indices, part.positions, 3, targetTris * 3, SIMPLIFY_ERROR);
  return { part: compact(indices, part.positions, part.normals, part.uvs), error };
};

const bounds = (positions: Float32Array) => {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let c = 0; c < 3; c += 1) {
      min[c] = Math.min(min[c]!, positions[i + c]!);
      max[c] = Math.max(max[c]!, positions[i + c]!);
    }
  }
  return { min, max };
};

const shift = (positions: Float32Array, by: readonly number[]): void => {
  for (let i = 0; i < positions.length; i += 3) {
    for (let c = 0; c < 3; c += 1) positions[i + c] = positions[i + c]! + by[c]!;
  }
};

/** A closed box, wound outward (positive signed volume): what `TriMeshFlags.ORIENTED` needs. */
const boxProxy = (min: readonly number[], max: readonly number[]): { positions: Float32Array; indices: Uint32Array } => {
  const [x0, y0, z0] = min as [number, number, number];
  const [x1, y1, z1] = max as [number, number, number];
  const positions = Float32Array.from([
    x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0,
    x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
  ]);
  const indices = Uint32Array.from([
    0, 2, 1, 0, 3, 2, // -Z
    4, 5, 6, 4, 6, 7, // +Z
    0, 4, 7, 0, 7, 3, // -X
    1, 2, 6, 1, 6, 5, // +X
    0, 1, 5, 0, 5, 4, // -Y
    3, 7, 6, 3, 6, 2, // +Y
  ]);
  return { positions, indices };
};

const resizeJpeg = (bytes: Buffer, work: string, name: string): Buffer => {
  const input = join(work, `${name}.in`);
  const output = join(work, `${name}.jpg`);
  writeFileSync(input, bytes);
  try {
    execFileSync("sips", ["-Z", String(TEXTURE_SIZE), "-s", "format", "jpeg", "-s", "formatOptions", String(JPEG_QUALITY), input, "--out", output], {
      stdio: "ignore",
    });
  } catch (err) {
    throw new Error(`convert-fan: resizing textures needs macOS \`sips\` (${(err as Error).message})`);
  }
  return readFileSync(output);
};

await MeshoptSimplifier.ready;

const { json: rawJson, bin } = readGlb(readFileSync(source));
const json = rawJson as SourceJson;
const nodes = json.nodes ?? [];
// The fan is the meshed node with the most triangles; anything else (Blender's `Cube`) is dropped.
const meshed = nodes.filter((node) => node.mesh !== undefined);
const fanNode = meshed
  .map((node) => ({ node, tris: json.meshes[node.mesh!]!.primitives.reduce((sum, p) => sum + json.accessors[p.indices!]!.count / 3, 0) }))
  .sort((a, b) => b.tris - a.tris)[0]?.node;
if (!fanNode) throw new Error("convert-fan: no meshed node in the source");
if (fanNode.translation || fanNode.matrix || fanNode.scale || fanNode.rotation) {
  throw new Error("convert-fan: the fan node carries a transform; apply it in Blender first");
}
const primitives = json.meshes[fanNode.mesh!]!.primitives;
if (primitives.length !== 1) throw new Error(`convert-fan: expected one primitive, got ${primitives.length}`);
const primitive = primitives[0]!;
const positions = readAccessor(json, bin, primitive.attributes.POSITION!) as Float32Array;
const normals = readAccessor(json, bin, primitive.attributes.NORMAL!) as Float32Array;
const uvs = readAccessor(json, bin, primitive.attributes.TEXCOORD_0!) as Float32Array;
const indices = readAccessor(json, bin, primitive.indices!) as Uint32Array;

// 1. SPLIT, in the export's own frame: the rule was measured there.
const rotorIndices: number[] = [];
const housingIndices: number[] = [];
for (let t = 0; t < indices.length; t += 3) {
  const [a, b, c] = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
  const cx = (positions[a * 3]! + positions[b * 3]! + positions[c * 3]!) / 3;
  const cy = (positions[a * 3 + 1]! + positions[b * 3 + 1]! + positions[c * 3 + 1]!) / 3;
  const cz = (positions[a * 3 + 2]! + positions[b * 3 + 2]! + positions[c * 3 + 2]!) / 3;
  (Math.hypot(cx, cz) < FAN_ROTOR_RADIUS && cy > FAN_ROTOR_ABOVE_Y ? rotorIndices : housingIndices).push(a, b, c);
}

// 3. SEAT (before simplifying, so both parts share one frame).
const whole = bounds(positions);
const seat = [-(whole.min[0]! + whole.max[0]!) / 2, -whole.min[1]!, -(whole.min[2]! + whole.max[2]!) / 2];
shift(positions, seat);

// 2. SIMPLIFY each part on its own.
const housing = simplify(compact(housingIndices, positions, normals, uvs), HOUSING_TARGET_TRIS);
const rotor = simplify(compact(rotorIndices, positions, normals, uvs), ROTOR_TARGET_TRIS);

// The rotor turns about its own centre, not the pivot's.
const rotorBounds = bounds(rotor.part.positions);
const axis = [(rotorBounds.min[0]! + rotorBounds.max[0]!) / 2, 0, (rotorBounds.min[2]! + rotorBounds.max[2]!) / 2];
shift(rotor.part.positions, [-axis[0]!, 0, -axis[2]!]);

// 4. PROXY around the housing, seated.
const housingBounds = bounds(housing.part.positions);
const proxy = boxProxy([housingBounds.min[0]!, 0, housingBounds.min[2]!], [housingBounds.max[0]!, whole.max[1]! - whole.min[1]!, housingBounds.max[2]!]);

// 6. TEXTURES, re-encoded.
const work = mkdtempSync(join(tmpdir(), "convert-fan-"));
const images = (json.images ?? []).map((image, i) => {
  const view = json.bufferViews[image.bufferView!]!;
  const bytes = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  return resizeJpeg(Buffer.from(bytes), work, `image${i}`);
});
rmSync(work, { recursive: true, force: true });

// Pack everything into one BIN chunk, 4-byte aligned.
const chunks: Buffer[] = [];
let byteLength = 0;
const bufferViews: Record<string, unknown>[] = [];
const accessors: Record<string, unknown>[] = [];
const addView = (bytes: Buffer, target?: number): number => {
  const pad = (4 - (byteLength % 4)) % 4;
  if (pad) {
    chunks.push(Buffer.alloc(pad));
    byteLength += pad;
  }
  bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, ...(target ? { target } : {}) });
  chunks.push(bytes);
  byteLength += bytes.length;
  return bufferViews.length - 1;
};
const addFloats = (data: Float32Array, type: "VEC2" | "VEC3", withBounds = false): number => {
  const view = addView(Buffer.from(data.buffer, data.byteOffset, data.byteLength), 34962);
  const width = COMPONENTS[type]!;
  const accessor: Record<string, unknown> = { bufferView: view, componentType: 5126, count: data.length / width, type };
  if (withBounds) {
    const { min, max } = bounds(data);
    accessor.min = min;
    accessor.max = max;
  }
  accessors.push(accessor);
  return accessors.length - 1;
};
const addIndices = (data: Uint32Array): number => {
  const view = addView(Buffer.from(data.buffer, data.byteOffset, data.byteLength), 34963);
  accessors.push({ bufferView: view, componentType: 5125, count: data.length, type: "SCALAR" });
  return accessors.length - 1;
};
const texturedPrimitive = (part: Part) => ({
  attributes: {
    POSITION: addFloats(part.positions, "VEC3", true),
    NORMAL: addFloats(part.normals, "VEC3"),
    TEXCOORD_0: addFloats(part.uvs, "VEC2"),
  },
  indices: addIndices(part.indices),
  material: 0,
});
const meshes = [
  { name: "fan_housing", primitives: [texturedPrimitive(housing.part)] },
  { name: "fan_rotor", primitives: [texturedPrimitive(rotor.part)] },
  { name: "fan_proxy", primitives: [{ attributes: { POSITION: addFloats(proxy.positions, "VEC3", true) }, indices: addIndices(proxy.indices) }] },
];
const imageViews = images.map((bytes) => addView(bytes));

const material = { ...json.materials![primitive.material!]! };
delete material.name;
const out: Gltf = {
  asset: { version: "2.0", generator: "scripts/convert-fan.ts (rotor split + meshopt simplify + box proxy)" },
  scene: 0,
  scenes: [{ nodes: [0, 1, 2] }],
  nodes: [
    { name: "fan_Visual", mesh: 0, extras: { role: "visual" } },
    {
      name: "fan_Rotor_Visual",
      mesh: 1,
      ...(axis[0] !== 0 || axis[2] !== 0 ? { translation: [axis[0]!, 0, axis[2]!] as [number, number, number] } : {}),
      extras: { role: "visual", spin: FAN_ROTOR_SPIN },
    },
    { name: "fan_Collision", mesh: 2, extras: { role: "collision" } },
  ],
  meshes,
  materials: [material],
  textures: json.textures,
  samplers: json.samplers,
  images: imageViews.map((bufferView) => ({ bufferView, mimeType: "image/jpeg" })),
  accessors,
  bufferViews,
  buffers: [{ byteLength }],
};

// 5. SOLIDS, off the seated proxy.
const packed = Buffer.concat(chunks);
const parts = addSolidNodes(out, packed);
const glb = writeGlb(out, packed);
writeFileSync(target, glb);

const model = readAssetModel(new Uint8Array(glb));
const collision = bounds(Float32Array.from(model.collision.flatMap((mesh) => mesh.positions.flatMap((p) => [p.x, p.y, p.z]))));
const round = (n: number): number => Number(n.toFixed(4));
console.log(`fan.glb  ${(glb.length / 1e6).toFixed(2)} MB`);
console.log(`  housing ${housing.part.indices.length / 3} tris (error ${housing.error.toFixed(4)})`);
console.log(`  rotor   ${rotor.part.indices.length / 3} tris (error ${rotor.error.toFixed(4)}), axis at x ${round(axis[0]!)} z ${round(axis[2]!)}, spin ${FAN_ROTOR_SPIN} rad/s`);
console.log(`  images  ${images.map((bytes) => `${(bytes.length / 1e3).toFixed(0)} kB`).join(", ")}`);
console.log(`  solids  ${describeParts(parts)}`);
console.log(
  `  footprint center { x: ${round((collision.min[0]! + collision.max[0]!) / 2)}, y: ${round(collision.max[1]! / 2)}, z: ${round((collision.min[2]! + collision.max[2]!) / 2)} }` +
    ` halfExtents { x: ${round((collision.max[0]! - collision.min[0]!) / 2)}, y: ${round(collision.max[1]! / 2)}, z: ${round((collision.max[2]! - collision.min[2]!) / 2)} }`,
);
