/**
 * Bomb converter (ADR 0126): turns the two animated drops of `BLIP_Bombs_v1`
 * into the game's only bombs, `bomb_A.glb` and `bomb_B.glb`.
 *
 * The drop already carries a `role` on every node — `visual`, `solid`, and
 * the `effect` role the shared reader now passes by — and three clips the
 * client plays for looks. What the game still needs done to it:
 *
 *   1. BLACK      The body's UVs move from the KayKit atlas's blue swatch
 *                 (bottom-left) to its black one (top-left), a whole swatch
 *                 up, so the gradient is kept. The shell fragments the
 *                 explosion throws are darkened to match.
 *   2. COLLISION  The shared reader wants a collision mesh and the drop
 *                 removed its duplicate one, so the body's own mesh is
 *                 referenced again under `role: "collision"` — no bytes
 *                 copied. A placed bomb is always a Prop, which collides as
 *                 the authored `solid_0_hull`; this is only for the reader.
 *   3. NAMES      `bomb_A_blue_visual` loses a colour it no longer has.
 *
 * The clips are kept, untouched. Nothing but the client's drawing plays them
 * (ADR 0126): the body's pose is the Prop's, and the fuse and the blast are
 * Tick arithmetic on the server.
 *
 * Usage:  pnpm convert:bomb
 *
 * It prints each file's footprint for `bombAssetDefs.ts`, which stays
 * hand-authored — two files are not a pack.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { measureBounds, readGlb, writeGlb, type Gltf, type GltfNode } from "./convert-lib.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assets = join(root, "assets");
const sources = join(assets, "bomb_source");

const FILES = [
  { source: "kaykit_bomb_A_blue_animated.glb", id: "bomb_A" },
  { source: "kaykit_bomb_B_blue_animated.glb", id: "bomb_B" },
] as const;

/** The atlas's blue swatch: the first column of its bottom row, in glTF UV space (v down). */
const BLUE_SWATCH = { uMax: 0.125, vMin: 0.75 } as const;
/** How far up the black swatch sits: the same column of the top row. */
const TO_BLACK_V = -0.75;
/** The shell fragments' colour once the shell is black — a hair off black so they still catch the light. */
const SHELL_FRAGMENT_BLACK = [0.035, 0.035, 0.042, 1];

interface Accessor {
  bufferView?: number;
  byteOffset?: number;
  count: number;
  type: string;
  componentType: number;
}

interface BombJson extends Gltf {
  accessors: Accessor[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  meshes: { primitives: { attributes: Record<string, number>; material?: number }[] }[];
  materials: { name?: string; pbrMetallicRoughness?: { baseColorFactor?: number[] } }[];
  animations?: { name?: string }[];
}

const FLOAT = 5126;

/** Move every UV on `accessorIndex` that samples the blue swatch onto the black one, in place. */
const blackenUvs = (json: BombJson, bin: Buffer, accessorIndex: number): number => {
  const accessor = json.accessors[accessorIndex]!;
  if (accessor.type !== "VEC2" || accessor.componentType !== FLOAT || accessor.bufferView === undefined) {
    throw new Error(`TEXCOORD_0 accessor ${accessorIndex} is not a float VEC2 on a bufferView`);
  }
  const view = json.bufferViews[accessor.bufferView]!;
  const stride = view.byteStride ?? 8;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  let moved = 0;
  for (let i = 0; i < accessor.count; i += 1) {
    const at = start + i * stride;
    const u = bin.readFloatLE(at);
    const v = bin.readFloatLE(at + 4);
    if (u > BLUE_SWATCH.uMax || v < BLUE_SWATCH.vMin) continue;
    bin.writeFloatLE(v + TO_BLACK_V, at + 4);
    moved += 1;
  }
  return moved;
};

for (const file of FILES) {
  const { json: raw, bin } = readGlb(readFileSync(join(sources, file.source)));
  const json = raw as BombJson;
  const nodes = json.nodes as GltfNode[];

  const visualIndex = nodes.findIndex((node) => node.extras?.role === "visual" && node.mesh !== undefined);
  if (visualIndex < 0) throw new Error(`${file.source}: no visual body`);
  const visual = nodes[visualIndex]!;
  const pulse = nodes.find((node) => node.children?.includes(visualIndex));
  if (!pulse || pulse.name !== "Bomb_Pulse") throw new Error(`${file.source}: the body is not under Bomb_Pulse`);

  // 1. BLACK
  const primitives = json.meshes[visual.mesh!]!.primitives;
  let moved = 0;
  for (const primitive of primitives) {
    const uv = primitive.attributes.TEXCOORD_0;
    if (uv === undefined) throw new Error(`${file.source}: the body has no UVs`);
    moved += blackenUvs(json, bin, uv);
  }
  if (moved === 0) throw new Error(`${file.source}: nothing sampled the blue swatch — has the atlas moved?`);
  const shell = json.materials.find((material) => material.name?.includes("shell fragments"));
  if (!shell?.pbrMetallicRoughness) throw new Error(`${file.source}: no shell-fragment material`);
  shell.pbrMetallicRoughness.baseColorFactor = SHELL_FRAGMENT_BLACK;
  shell.name = "FX • black shell fragments";

  // 3. NAMES
  visual.name = `${file.id}_visual`;

  // 2. COLLISION — a sibling of the body under the same pulse, so its rest
  // transform is the body's. The client's role filter drops it before drawing.
  const { translation, rotation, scale, matrix } = visual;
  nodes.push({
    name: `${file.id}_collision`,
    mesh: visual.mesh,
    extras: { role: "collision" },
    ...(translation ? { translation } : {}),
    ...(rotation ? { rotation } : {}),
    ...(scale ? { scale } : {}),
    ...(matrix ? { matrix } : {}),
  });
  pulse.children = [...(pulse.children ?? []), nodes.length - 1];

  const glb = writeGlb(json, bin);
  writeFileSync(join(assets, `${file.id}.glb`), glb);
  const { center, half } = measureBounds(glb);
  console.log(`${file.id}: ${moved} body UVs to black; clips ${(json.animations ?? []).map((a) => a.name).join(", ")}`);
  console.log(`  footprint center ${JSON.stringify(center)} half ${JSON.stringify(half)}`);
}
