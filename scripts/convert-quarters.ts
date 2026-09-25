/**
 * Quarter pieces: two arc-centred masters → a sized family of pipeline-ready
 * `.glb`s seated on the Asset pivot, plus generated registry defs.
 *
 * The masters in `assets/quarter_pieces/` were modelled about the centre of
 * the circle they belong to — a quarter disc of radius 1, and a quarter
 * annulus from radius 1 to 2 — so four of them rotate into a ring. That made
 * them the only Assets not X/Z centred, and placing one in the builder meant
 * working a unit off its own gizmo (the user's call on 2026-09-18 reversed
 * the exemption). Every output here is seated like every other Asset: X/Z
 * centred on its nominal square, resting on y = 0.
 *
 * Each shape comes in every size from 1×1 to 8×8, one metre tall — the KayKit
 * `platform_NxNx1` family's shape, and why the scale is X/Z only: a Segment's
 * own scale is uniform (ADR 0062), so a 4×4 it could already make would be
 * four metres tall. Like every converter, this repackages and never remodels:
 * the mesh bytes are the master's, only the scene roots' transforms change
 * (and a solid hull's points, which the reader places rigidly, so a scale has
 * to be baked into them). A quarter curve N×N wraps the quarter circle
 * (N/2)×(N/2), as the masters do.
 *
 * The 1×1 circle and the 2×2 curve keep the master's own ids, unsized, so
 * Tracks already storing them still load.
 *
 * Usage:  pnpm convert:quarters. Re-runnable: outputs and the generated defs
 *         are overwritten in place.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emitDefsFile, measureBounds, readGlb, writeGlb, type Gltf, type MeasuredDef } from "./convert-lib.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = join(root, "assets");

interface Master {
  shape: "circle" | "curve";
  /** The master's width and depth: it spans 0…extent on X and Z from its arc centre. */
  extent: number;
  /** Extras on the visual node measured along X/Z, rescaled with the piece. */
  lengths: readonly string[];
}

const MASTERS: readonly Master[] = [
  { shape: "circle", extent: 1, lengths: ["radius", "outer_radius"] },
  { shape: "curve", extent: 2, lengths: ["inner_radius", "outer_radius", "track_width"] },
];

const SIZES = [1, 2, 3, 4, 5, 6, 7, 8];

const idFor = ({ shape, extent }: Master, size: number): string =>
  size === extent ? `kaykit_platform_quarter_${shape}_blue` : `kaykit_platform_quarter_${shape}_${size}x${size}x1_blue`;

/** 1e-7 is the masters' own precision; anything finer is float noise from the multiply. */
const tidy = (n: number): number => Math.round(n * 1e7) / 1e7 || 0;

/**
 * The master re-seated at `size`: every root scaled by `k` on X/Z about the
 * arc centre, then moved so the nominal square is centred on the origin. The
 * masters' roots carry no transform, which is what makes that one TRS.
 */
const seatAtSize = (master: Master, json: Gltf, size: number): void => {
  const k = size / master.extent;
  for (const index of json.scenes?.[0]?.nodes ?? []) {
    const node = json.nodes![index]!;
    if (node.matrix || node.translation || node.rotation || node.scale || node.children) {
      throw new Error(`${master.shape}: root "${node.name}" is transformed — the masters' roots must be bare`);
    }
    node.translation = [-size / 2, 0, -size / 2];
    const extras = node.extras ?? {};
    if (extras.role === "solid") {
      const shape = extras.shape as { type: string; points?: number[] };
      if (shape.type !== "hull") throw new Error(`${master.shape}: solid "${node.name}" is a ${shape.type}, only hulls are rescaled`);
      shape.points = shape.points!.map((v, i) => tidy(i % 3 === 1 ? v : v * k));
      continue;
    }
    if (k !== 1) node.scale = [k, 1, k];
    for (const key of master.lengths) {
      if (typeof extras[key] === "number") extras[key] = tidy((extras[key] as number) * k);
    }
  }
};

const defs: MeasuredDef[] = [];
const arcCentres: string[] = [];

for (const master of MASTERS) {
  const source = readFileSync(join(assetsDir, "quarter_pieces", `quarter_${master.shape}_blue.glb`));
  const { center } = measureBounds(Buffer.from(source));
  if (Math.abs(center.x - master.extent / 2) > 1e-3 || Math.abs(center.z - master.extent / 2) > 1e-3) {
    throw new Error(`${master.shape}: master is not arc-centred (bounds centre ${center.x}, ${center.z})`);
  }
  for (const size of SIZES) {
    const { json, bin } = readGlb(source);
    seatAtSize(master, json, size);
    const id = idFor(master, size);
    const glb = writeGlb(json, bin);
    writeFileSync(join(assetsDir, `${id}.glb`), glb);
    const { center: c, half } = measureBounds(glb);
    defs.push({ id, category: "floor", center: c, half });
    arcCentres.push(`  ${id}: { x: ${-size / 2}, z: ${-size / 2} },`);
    console.log(`  ${id}: ${(half.x * 2).toFixed(3)} × ${(half.y * 2).toFixed(3)} × ${(half.z * 2).toFixed(3)}`);
  }
}

defs.sort((a, b) => (a.id < b.id ? -1 : 1));
arcCentres.sort();
emitDefsFile(
  join(root, "packages", "shared", "src", "track", "quarterAssetDefs.ts"),
  "QUARTER_MODULE_DEFS",
  `// GENERATED by \`pnpm convert:quarters\` — do not hand-edit.\n` +
    `// The quarter circle and quarter curve, 1×1 to 8×8 and one metre tall,\n` +
    `// seated on the Asset pivot: footprints measured with the real shared\n` +
    `// reader off the converted bytes. Socketless (free placement).\n` +
    `// Re-run the script to regenerate.`,
  defs,
  `\n/**\n` +
    ` * Where each quarter piece's circle is centred, in its own frame: the corner\n` +
    ` * of its footprint the arc curls around. Four pieces turned 0/90/180/270°\n` +
    ` * about this point make a ring — what \`disc\` in \`authoring.ts\` builds.\n` +
    ` */\n` +
    `export const QUARTER_ARC_CENTRES: Readonly<Record<string, { x: number; z: number }>> = {\n${arcCentres.join("\n")}\n};\n`,
);

console.log(`converted ${defs.length} quarter pieces (${SIZES.length} sizes × ${MASTERS.length} shapes), defs written to quarterAssetDefs.ts`);
