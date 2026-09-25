/**
 * Grafts clips from the collider rig into the rig the game draws (ADR 0128).
 *
 * BLIP comes in two files that share one skeleton, node for node:
 *
 *   - `apps/client/public/models/BLIP.glb` — what the game loads: the skins
 *     pack's export (ADR 0091), with the body's UVs and its textured material.
 *   - `apps/client/public/models/blip_with_coliders.glb` — the same rig plus
 *     the fifteen `COL_*` hulls the ragdoll is baked from, and the file new
 *     clips arrive in.
 *
 * Replacing `BLIP.glb` with the collider file would put fifteen hull meshes
 * in every Round and lose the older clips' own extras, so the clips move
 * instead. Every clip named on the command line (or, with none named, every
 * clip the collider file has that `BLIP.glb` lacks) is copied across: its
 * keyframes appended to the BIN chunk, its channels re-aimed at the node of
 * the same name. A clip already in `BLIP.glb` is replaced. Nothing else in
 * `BLIP.glb` changes.
 *
 * Usage:  pnpm graft:blip [ClipName ...]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readGlb, writeGlb, type Gltf } from "./convert-lib.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const models = join(root, "apps/client/public/models");
const TARGET = join(models, "BLIP.glb");
const SOURCE = join(models, "blip_with_coliders.glb");

interface Accessor {
  bufferView?: number;
  byteOffset?: number;
  [key: string]: unknown;
}
interface BufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
  [key: string]: unknown;
}
interface Animation {
  name?: string;
  samplers: { input: number; output: number; interpolation?: string }[];
  channels: { sampler: number; target: { node?: number; path: string } }[];
  extras?: unknown;
}
interface RigJson extends Gltf {
  accessors: Accessor[];
  bufferViews: BufferView[];
  animations?: Animation[];
}

const target = readGlb(readFileSync(TARGET));
const source = readGlb(readFileSync(SOURCE));
const into = target.json as RigJson;
const from = source.json as RigJson;
into.animations ??= [];

const have = new Set(into.animations.map((clip) => clip.name));
const named = process.argv.slice(2);
const clips = (from.animations ?? []).filter((clip) => (named.length > 0 ? named.includes(clip.name ?? "") : !have.has(clip.name)));
const missing = named.filter((name) => !clips.some((clip) => clip.name === name));
if (missing.length > 0) throw new Error(`not in ${SOURCE}: ${missing.join(", ")}`);
if (clips.length === 0) {
  console.log("BLIP.glb already has every clip the collider file has.");
  process.exit(0);
}

const nodeByName = new Map((into.nodes ?? []).map((node, index) => [node.name, index]));
const chunks: Buffer[] = [target.bin];
let length = target.bin.length;
/** Copies accessor `index` of the source (and the bytes it reads) into the target; returns its new index. */
const copyAccessor = (index: number): number => {
  const accessor = from.accessors[index]!;
  if (accessor.bufferView === undefined) throw new Error(`accessor ${index} has no bufferView`);
  const view = from.bufferViews[accessor.bufferView]!;
  if (view.byteStride) throw new Error(`accessor ${index} is interleaved`);
  const start = view.byteOffset ?? 0;
  const bytes = source.bin.subarray(start, start + view.byteLength);
  const pad = (4 - (length % 4)) % 4;
  if (pad > 0) {
    chunks.push(Buffer.alloc(pad));
    length += pad;
  }
  into.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.length });
  chunks.push(Buffer.from(bytes));
  length += bytes.length;
  into.accessors.push({ ...accessor, bufferView: into.bufferViews.length - 1 });
  return into.accessors.length - 1;
};

for (const clip of clips) {
  const channels = clip.channels.map((channel) => {
    const name = from.nodes?.[channel.target.node ?? -1]?.name;
    const node = nodeByName.get(name);
    if (node === undefined) throw new Error(`${clip.name}: no node "${name}" in BLIP.glb`);
    return { ...channel, target: { ...channel.target, node } };
  });
  const samplers = clip.samplers.map((sampler) => ({
    ...sampler,
    input: copyAccessor(sampler.input),
    output: copyAccessor(sampler.output),
  }));
  const grafted: Animation = { ...clip, samplers, channels };
  const at = into.animations.findIndex((existing) => existing.name === clip.name);
  if (at >= 0) into.animations[at] = grafted;
  else into.animations.push(grafted);
  console.log(`${at >= 0 ? "replaced" : "grafted"} ${clip.name} (${channels.length} channels)`);
}

const bin = Buffer.concat(chunks);
into.buffers![0]!.byteLength = bin.length;
writeFileSync(TARGET, writeGlb(into, bin));
console.log(`wrote ${TARGET} (${into.animations.length} clips)`);
