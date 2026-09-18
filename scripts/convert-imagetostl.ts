/**
 * ImageToStl one-shot converter: raw single-mesh `.glb` files → role-marked
 * pipeline `.glb` + generated registry defs.
 *
 * The pack is already GLB (no container conversion), but its nodes carry no
 * roles and its names are Blender's (`Circle.001`, `arrow_001`): every
 * role-less meshed node is duplicated into `collision` + `visual` nodes over
 * the same mesh (see convert-lib.ts), and Blender `_NNN` duplicates are
 * dropped by geometry hash — same shape in, one module out. Materials and
 * embedded images pass through untouched (the pack's authored look; the twin
 * tests split textured/untextured files honestly — see convert-kaykit.ts).
 *
 * Every piece is seated on the Asset pivot (X/Z centred, resting on y = 0 —
 * the pack keeps each one where it sat in one shared Blender scene, up to
 * 23 m out) and scaled by `TRAP_PACK_SCALE`. Footprints are measured with
 * the real shared reader off the converted bytes; defs are socketless (free
 * placement) until builder eyeballing says otherwise.
 *
 * Usage:  pnpm convert:traps. Re-runnable: converted files + the generated
 *         defs are overwritten in place.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addRolePairs,
  categorize,
  emitDefsFile,
  geometryHash,
  measureBounds,
  readGlb,
  seatOnPivot,
  writeGlb,
  launchHeightFor,
  type CategoryRules,
  type LaunchRules,
  type MeasuredDef,
} from "./convert-lib.js";
import { addSolidNodes, describeParts } from "./convert-solids.js";
import { LAUNCH_HEIGHT_PRESETS } from "../packages/shared/src/tuning/authoring.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = join(root, "assets");

const dir = join(assetsDir, "ImageToStl.com_b9c1840fd6664ad5b711aa53fd3226bb");
const files = readdirSync(dir).filter((f) => f.endsWith(".glb"));

/**
 * The pack is modelled ~4× under the game's scale: its small platform tile is
 * 0.39 m across against a 1.7 m-tall, 0.7 m-wide Character. 3.6 makes its big
 * platform tile (1.106 m) the KayKit 4×4 floor's 4 m, so the two packs share
 * one grid; everything else in the pack keeps its authored proportions.
 */
const TRAP_PACK_SCALE = 3.6;

/** Asset category by stem — reviewed in the builder, not guessed at runtime. */
const CATEGORY_RULES: CategoryRules = [
  [/^platformspike/, "obstacle"],
  // Before the platform rule: a spring platform is a Spring first (ADR 0069).
  [/^platformspring/, "spring"],
  [/^(platform|platfrom|clay)/, "platform"],
  [/^(arrow|arrowtrap|arrowtrapbig|ball|hammer|hammerbig|trap|trapball|trapcircle.*)$/, "obstacle"],
  // Not a Gate despite the name (ADR 0068): a flat D outline 0.5 × 2 × 0.1 with no opening a Character fits through.
  [/^(arch|fence|fencebig|fencesmall|target)$/, "scenery"],
];

/**
 * Spiked pieces (ADR 0061) by stem: every contact knocks down. The spike
 * plates and the spiked saw discs — not their smooth twins, and not the
 * arrows, which are Projectile shapes with no mechanic of their own yet.
 */
const SPIKED_STEMS = /^(platformspike|trapcirclespike|trapcirclehorizontalspike)/;

/**
 * Which trap-pack Assets are Springs (CONTEXT.md: Spring, ADR 0069) — the
 * spring platforms, per stem like the spikes above. A deck you stand on that
 * also throws you; the coloured variants are one piece in three paints, so
 * they all throw the same.
 */
const LAUNCH_RULES: LaunchRules = [[/^platformspring/, LAUNCH_HEIGHT_PRESETS.medium]];

const defs: MeasuredDef[] = [];
const seen = new Map<string, string>();
const usedIds = new Set<string>();

for (const file of files) {
  const { json, bin } = readGlb(new Uint8Array(readFileSync(join(dir, file))));
  addRolePairs(json);
  // Dedupe on the pack's own placement: its colour variants share one mesh
  // shape (the colour is in the UVs, which the hash doesn't read) and differ
  // only by where they sat, so hashing after seating would merge them.
  const hash = geometryHash(writeGlb(json, bin));
  if (seen.has(hash)) {
    console.log(`  skip ${file}: same geometry as ${seen.get(hash)}`);
    continue;
  }
  seen.set(hash, file);

  // `arrow_001` → `trap_arrow`; a genuinely different shape that lands on a
  // taken id keeps a numeric suffix rather than overwriting.
  const stem = file.replace(/\.glb$/, "").replace(/_\d{3}$/, "");
  let id = `trap_${stem}`;
  for (let n = 2; usedIds.has(id); n += 1) id = `trap_${stem}_${n}`;
  usedIds.add(id);

  seatOnPivot(json, bin, TRAP_PACK_SCALE);
  // Solid parts (ADR 0065) in the seated, scaled frame — what a Moving Segment collides as.
  const solid = addSolidNodes(json, bin);
  console.log(`  ${id}: ${describeParts(solid)}`);
  const glb = writeGlb(json, bin);
  writeFileSync(join(assetsDir, `${id}.glb`), glb);
  const { center, half } = measureBounds(glb);
  const launchHeight = launchHeightFor(stem, LAUNCH_RULES);
  defs.push({
    id,
    category: categorize(id, stem, CATEGORY_RULES),
    ...(SPIKED_STEMS.test(stem) ? { hazard: "spiked" as const } : {}),
    center,
    half,
    ...(launchHeight === undefined ? {} : { launchHeight }),
  });
}

defs.sort((a, b) => (a.id < b.id ? -1 : 1));
emitDefsFile(
  join(root, "packages", "shared", "src", "track", "trapAssetDefs.ts"),
  "TRAP_MODULE_DEFS",
  `// GENERATED by \`pnpm convert:traps\` — do not hand-edit.\n` +
    `// ImageToStl pack (${defs.length} shapes, textured as authored), seated on the\n` +
    `// Asset pivot and scaled ${TRAP_PACK_SCALE}×: footprints measured with the real\n` +
    `// shared reader off the converted bytes. Socketless (free placement).\n` +
    `// Re-run the script to regenerate.`,
  defs,
);

console.log(`converted ${defs.length} files, defs written to trapAssetDefs.ts`);
