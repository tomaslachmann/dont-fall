/**
 * Gate openings (ADR 0068): for every Gate-category Asset, find where a
 * Character can pass through it, from its converted collision, and write
 * `packages/shared/src/track/gateAssetDefs.ts`.
 *
 * Rays are cast through the Asset along a through-direction `n` tilted about
 * its X axis, one per cell of a grid on the plane across it; a cell whose ray
 * hits nothing is open. An opening enclosed on every side (a hoop's ring) is
 * looked for first, at the tilt that shows the most of it — a hoop leaning
 * back shows its full ring only when looked at along its own axis. A Gate
 * with none (an arch, a sign's posts) is open down to the floor instead,
 * taken upright. The largest such region is the opening.
 *
 * Usage:  pnpm fit:gates  (after either converter). Re-runnable.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import RAPIER from "@dimforge/rapier3d-compat";
import { readAssetModel } from "../packages/shared/src/track/asset.js";
import { ASSET_MODULE_DEFS } from "../packages/shared/src/track/assetModules.js";
import { encodeGateMask, gateAxes, type GateDef, type GateOpening } from "../packages/shared/src/track/Gate.js";
import type { Vec3 } from "../packages/shared/src/math/vec3.js";

await RAPIER.init();

/** Probe cell size, in Asset units. */
export const GATE_CELL = 0.1;
/** Smallest enclosed opening (units²) that counts as a hoop's ring rather than a gap in the art. */
export const MIN_ENCLOSED_AREA = 1;
/** Smallest opening of any kind; below it the Asset has no usable opening and fitting fails. */
export const MIN_OPENING_AREA = 0.1;
/** Tilts tried, coarse then refined around the best: degrees either side of upright. */
const MAX_TILT_DEGREES = 60;

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const along = (u: Vec3, a: number, v: Vec3, b: number, n: Vec3, c: number): Vec3 => ({
  x: u.x * a + v.x * b + n.x * c,
  y: u.y * a + v.y * b + n.y * c,
  z: u.z * a + v.z * b + n.z * c,
});

interface Probe {
  tilt: number;
  origin: Vec3;
  cols: number;
  rows: number;
  /** The chosen region's cells (1) — empty when none qualifies. */
  region: Uint8Array;
  area: number;
}

/** Open cells at `tilt`, and the largest region bounded on every side (or, `floor`, on every side but the bottom). */
const probe = (world: RAPIER.World, points: Vec3[], tilt: number, floor: boolean): Probe => {
  const { u, v, n } = gateAxes(tilt);
  let [u0, u1, v0, v1, n0, n1] = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
  for (const p of points) {
    const [pu, pv, pn] = [dot(p, u), dot(p, v), dot(p, n)];
    [u0, u1, v0, v1, n0, n1] = [Math.min(u0, pu), Math.max(u1, pu), Math.min(v0, pv), Math.max(v1, pv), Math.min(n0, pn), Math.max(n1, pn)];
  }
  const cols = Math.max(1, Math.ceil((u1 - u0) / GATE_CELL));
  const rows = Math.max(1, Math.ceil((v1 - v0) / GATE_CELL));
  const open = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const start = along(u, u0 + (c + 0.5) * GATE_CELL, v, v0 + (r + 0.5) * GATE_CELL, n, n0 - 1);
      open[r * cols + c] = world.castRay(new RAPIER.Ray(start, n), n1 - n0 + 2, false) ? 0 : 1;
    }
  }

  // Flood from the border (not the bottom row, with a floor): what it reaches is outside.
  const outside = new Uint8Array(open.length);
  const stack: number[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const border = c === 0 || c === cols - 1 || r === rows - 1 || (!floor && r === 0);
      const i = r * cols + c;
      if (border && open[i]) {
        outside[i] = 1;
        stack.push(i);
      }
    }
  }
  const flood = (seen: Uint8Array, from: number[], keep?: (i: number) => void): void => {
    while (from.length > 0) {
      const i = from.pop()!;
      keep?.(i);
      const r = Math.floor(i / cols);
      const c = i % cols;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
        const j = rr * cols + cc;
        if (open[j] && !seen[j]) {
          seen[j] = 1;
          from.push(j);
        }
      }
    }
  };
  flood(outside, stack);

  // The largest inside region.
  const claimed = Uint8Array.from(outside);
  let region = new Uint8Array(open.length);
  let best = 0;
  for (let i = 0; i < open.length; i += 1) {
    if (!open[i] || claimed[i]) continue;
    claimed[i] = 1;
    const cells: number[] = [];
    flood(claimed, [i], (j) => cells.push(j));
    if (cells.length > best) {
      best = cells.length;
      region = new Uint8Array(open.length);
      for (const j of cells) region[j] = 1;
    }
  }
  return { tilt, origin: along(u, u0, v, v0, n, (n0 + n1) / 2), cols, rows, region, area: best * GATE_CELL * GATE_CELL };
};

/** The tilt at the middle of the plateau where `area` is within 2% of its best — a symmetric shape comes out exactly upright. */
const plateauTilt = (probes: Probe[]): number => {
  const best = Math.max(...probes.map((p) => p.area));
  const near = probes.filter((p) => p.area >= best * 0.98);
  return near.reduce((sum, p) => sum + p.tilt, 0) / near.length;
};

const DEG = Math.PI / 180;

/** A Gate's opening from its collision meshes, in the Asset frame. Throws when it has none. */
export const fitGateOpening = (meshes: { positions: Vec3[]; indices: number[] }[]): GateOpening => {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const points: Vec3[] = [];
  for (const mesh of meshes) {
    points.push(...mesh.positions);
    world.createCollider(
      RAPIER.ColliderDesc.trimesh(new Float32Array(mesh.positions.flatMap((p) => [p.x, p.y, p.z])), new Uint32Array(mesh.indices)),
    );
  }
  world.step(); // builds the query structures

  try {
    const coarse: Probe[] = [];
    for (let deg = -MAX_TILT_DEGREES; deg <= MAX_TILT_DEGREES; deg += 5) coarse.push(probe(world, points, deg * DEG, false));
    const bestCoarse = coarse.reduce((a, b) => (b.area > a.area ? b : a));
    let chosen: Probe;
    if (bestCoarse.area >= MIN_ENCLOSED_AREA) {
      const fine: Probe[] = [];
      const centre = Math.round(bestCoarse.tilt / DEG);
      for (let deg = centre - 6; deg <= centre + 6; deg += 1) {
        if (Math.abs(deg) <= MAX_TILT_DEGREES) fine.push(probe(world, points, deg * DEG, false));
      }
      chosen = probe(world, points, Math.round(plateauTilt(fine) / DEG * 2) / 2 * DEG, false);
    } else {
      chosen = probe(world, points, 0, true);
    }
    if (chosen.area < MIN_OPENING_AREA) throw new Error(`no opening found (largest ${chosen.area.toFixed(2)} units²)`);

    const { u, v } = gateAxes(chosen.tilt);
    let [cu, cv, count] = [0, 0, 0];
    for (let i = 0; i < chosen.region.length; i += 1) {
      if (!chosen.region[i]) continue;
      cu += (i % chosen.cols) + 0.5;
      cv += Math.floor(i / chosen.cols) + 0.5;
      count += 1;
    }
    const round = (x: number): number => Math.round(x * 1e4) / 1e4;
    const vec = (p: Vec3): Vec3 => ({ x: round(p.x), y: round(p.y), z: round(p.z) });
    const center = {
      x: chosen.origin.x + u.x * (cu / count) * GATE_CELL + v.x * (cv / count) * GATE_CELL,
      y: chosen.origin.y + u.y * (cu / count) * GATE_CELL + v.y * (cv / count) * GATE_CELL,
      z: chosen.origin.z + u.z * (cu / count) * GATE_CELL + v.z * (cv / count) * GATE_CELL,
    };
    return {
      tilt: round(chosen.tilt),
      origin: vec(chosen.origin),
      cell: GATE_CELL,
      cols: chosen.cols,
      rows: chosen.rows,
      mask: encodeGateMask(chosen.region),
      center: vec(center),
    };
  } finally {
    world.free();
  }
};

/** A finish sign Qualifies; every other Gate can be a Checkpoint. */
export const gateRoleFor = (id: string): GateDef["role"] => (/signage_finish/.test(id) ? "finish" : "checkpoint");

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const entries: string[] = [];
  for (const def of ASSET_MODULE_DEFS.filter((d) => d.category === "gate").sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const model = readAssetModel(new Uint8Array(readFileSync(join(root, "assets", `${def.id}.glb`))));
    const opening = fitGateOpening(model.collision);
    const area = [...opening.mask].reduce((sum, h) => sum + [...Number.parseInt(h, 16).toString(2)].filter((b) => b === "1").length, 0) * GATE_CELL ** 2;
    console.log(`  ${def.id}: ${gateRoleFor(def.id)}, tilt ${(opening.tilt / DEG).toFixed(1)}°, ${opening.cols}×${opening.rows} cells, open ${area.toFixed(2)} units²`);
    entries.push(`  ${def.id}: { role: "${gateRoleFor(def.id)}", opening: ${JSON.stringify(opening)} },`);
  }
  writeFileSync(
    join(root, "packages", "shared", "src", "track", "gateAssetDefs.ts"),
    `// GENERATED by \`pnpm fit:gates\` — do not hand-edit (ADR 0068).\n` +
      `// Each Gate Asset's opening, probed from its converted collision.\n` +
      `import type { GateDef } from "./Gate.js";\n\n` +
      `export const GATE_ASSET_DEFS: Record<string, GateDef> = {\n${entries.join("\n")}\n};\n`,
  );
  console.log(`fitted ${entries.length} gates, written to gateAssetDefs.ts`);
}
