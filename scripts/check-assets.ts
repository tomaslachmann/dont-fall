/**
 * Asset export checker — run this after every Blender export, before wiring
 * a file into `ASSET_MODULE_DEFS`.
 *
 * It reads each GLB through the *real* shared reader (`readAssetModel`, ADR
 * 0050), so whatever passes here parses identically on the match server and
 * on every predicting client. It checks the three things that have actually
 * gone wrong in this repo, each of which is invisible in Blender's viewport
 * and expensive to find later:
 *
 *   1. ROLE     — every meshed node must resolve to collision or visual.
 *   2. FRAME    — the game is Y-up. A flat deck is thin in **Y**; a file
 *                 thin in Z is Z-up and will stand on edge in-game.
 *   3. WINDING  — collision colliders are built with `TriMeshFlags.ORIENTED`,
 *                 which is only correct for a closed, outward-wound mesh.
 *                 Positive signed volume proves both. A negative one usually
 *                 means a mirror modifier or a negative scale went out
 *                 unapplied, and in-game it means falling through the floor.
 *
 * Usage:  pnpm check:assets            (every file in assets/)
 *         pnpm check:assets track_straight_1x1 ramp_45
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readAssetModel, type AssetMeshData } from "../packages/shared/src/track/asset.js";

const assetsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");

const round = (n: number): number => (Math.abs(n) < 1e-6 ? 0 : Number(n.toFixed(4)));

const bounds = (meshes: AssetMeshData[]) => {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const mesh of meshes) {
    for (const p of mesh.positions) {
      for (const axis of ["x", "y", "z"] as const) {
        min[axis] = Math.min(min[axis], p[axis]);
        max[axis] = Math.max(max[axis], p[axis]);
      }
    }
  }
  return { min, max, size: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z } };
};

/** Six times the signed volume of a closed mesh — positive exactly when outward-wound. */
const signedVolume = (mesh: AssetMeshData): number => {
  let sum = 0;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.positions[mesh.indices[t]!]!;
    const b = mesh.positions[mesh.indices[t + 1]!]!;
    const c = mesh.positions[mesh.indices[t + 2]!]!;
    sum += a.x * (b.y * c.z - b.z * c.y) - a.y * (b.x * c.z - b.z * c.x) + a.z * (b.x * c.y - b.y * c.x);
  }
  return sum / 6;
};

const ids =
  process.argv.slice(2).length > 0
    ? process.argv.slice(2).map((arg) => arg.replace(/\.glb$/, ""))
    : readdirSync(assetsDir)
        .filter((file) => file.endsWith(".glb"))
        .map((file) => file.slice(0, -4))
        .sort();

let failed = 0;

for (const id of ids) {
  const problems: string[] = [];
  let model;
  try {
    model = readAssetModel(new Uint8Array(readFileSync(join(assetsDir, `${id}.glb`))));
  } catch (err) {
    console.log(`\n${id}\n  FAIL  ${(err as Error).message}`);
    failed += 1;
    continue;
  }

  const box = bounds(model.collision);
  const sorted = (["x", "y", "z"] as const).slice().sort((a, b) => box.size[a] - box.size[b]);
  const [thinnest, middle] = sorted as ["x" | "y" | "z", "x" | "y" | "z", "x" | "y" | "z"];

  // Y-up check, applied ONLY to slab-shaped pieces — one axis clearly
  // thinner than the other two, both of which are a real Module's worth of
  // size. A deck is a slab, and a Z-up deck is the failure this catches.
  //
  // Everything else is left alone deliberately: a side rail (0.2 x 0.4 x 2)
  // and a barrier (2 x 0.6 x 0.3) are *supposed* to be thin on a horizontal
  // axis, and a pillar or a 4x4x4 ramp has no thin axis to read a frame off
  // at all. Flagging those wastes an export cycle on a file that was right,
  // which is worse than not checking them.
  const isSlab = box.size[middle] >= box.size[thinnest] * 2 && box.size[middle] >= 1;
  if (isSlab && thinnest !== "y") {
    problems.push(
      `frame: this is a slab ${round(box.size.x)} x ${round(box.size.y)} x ${round(box.size.z)}, thin on ` +
        `${thinnest.toUpperCase()} rather than Y — its deck lies in ${thinnest === "z" ? "XY" : "YZ"}, so it looks Z-up. ` +
        `Re-export with Blender's "+Y Up" so the deck lies in XZ; in-game this piece stands on edge.`,
    );
  }

  for (const [i, mesh] of model.collision.entries()) {
    const volume = signedVolume(mesh);
    if (volume <= 0) {
      problems.push(
        `winding: collision mesh ${i} has signed volume ${round(volume)} (must be > 0) — inward-wound or not closed. ` +
          `In Blender: apply any negative scale/mirror, then Mesh > Normals > Recalculate Outside.`,
      );
    }
  }

  const line = (axis: "x" | "y" | "z") => `${axis}[${round(box.min[axis])}, ${round(box.max[axis])}]`;
  console.log(`\n${id}`);
  console.log(`  collision ${model.collision.length} / visual ${model.visual.length}   ${line("x")} ${line("y")} ${line("z")}`);
  if (problems.length === 0) {
    console.log("  OK");
  } else {
    failed += 1;
    for (const problem of problems) console.log(`  FAIL  ${problem}`);
  }
}

console.log(`\n${ids.length - failed}/${ids.length} files OK`);
if (failed > 0) process.exitCode = 1;
