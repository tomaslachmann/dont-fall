/**
 * KayKit one-shot converter: `.gltf` + `.bin` + `.png` → pipeline-ready
 * textured `.glb` + generated registry defs.
 *
 * Why conversion exists: the asset pipeline (ADR 0050) reads self-contained
 * GLB only — the shared reader parses binary chunks, and the client's
 * `GLTFLoader.parseAsync(bytes, "")` has no base path for external URIs.
 * Each file is repackaged (never remodeled): same mesh bytes, external
 * buffer + texture images embedded, and every role-less meshed node
 * duplicated into `collision` + `visual` nodes referencing the SAME mesh.
 *
 * Textures stay embedded (the pack's authored look) — the twin tests split
 * textured/untextured files honestly, because `GLTFLoader` decodes images
 * through browser-only globals (`self.URL`): textured files prove their
 * geometry + roles + footprint + winding in Node, and the browser proves
 * the textured parse live in the builder. Every piece is seated on the Asset
 * pivot (X/Z centred, resting on y = 0), unscaled — most already were.
 * Footprints are measured with the real shared reader off the converted
 * bytes; defs are socketless (free placement) until builder eyeballing
 * promotes chainable pieces.
 *
 * The pack's folders are NOT one shape set in five colours: `neutral` holds
 * 38 grey/white/wood pieces (floors, blocks, pillars, struts), and each of
 * `blue`/`green`/`red`/`yellow` holds the same 83 coloured ones (platforms,
 * slopes, pipes, railings, …) over its own texture. Every folder is
 * converted: neutral pieces keep bare `kaykit_<stem>` ids, a colour's pieces
 * are `kaykit_<stem>_<colour>` — a Module per colour, since an Asset is one
 * file.
 *
 * Usage:  pnpm convert:kaykit. Re-runnable: converted files + the generated
 *         defs are overwritten in place.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addRolePairs,
  categorize,
  embedImages,
  emitDefsFile,
  geometryHash,
  measureBounds,
  seatOnPivot,
  writeGlb,
  launchHeightFor,
  type CategoryRules,
  type LaunchRules,
  type Gltf,
  type MeasuredDef,
} from "./convert-lib.js";
import { addSolidNodes, describeParts } from "./convert-solids.js";
import { LAUNCH_HEIGHT_PRESETS } from "../packages/shared/src/tuning/authoring.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = join(root, "assets");

const VARIANTS = ["neutral", "blue", "green", "red", "yellow"] as const;

// Hand-promoted in assetModules.ts (PROMOTED_SOCKETED) — the .glb still gets
// (re)written, but no socketless twin def is emitted for these ids.
const PROMOTED_SOCKETED_IDS = new Set(["kaykit_floor_wood_2x2"]);

/**
 * Asset category by stem — reviewed in the builder, not guessed at runtime.
 * Platform is what a route is built out of, including the pieces holding it
 * up (pillars, struts, bracing) that nobody stands on; Scenery dresses or
 * bounds it (railings, signs, flags, and the collectible and
 * lever/button shapes, which have no mechanic yet). Gates are what a Player
 * passes through — hoops and arches (Checkpoints) and the finish signs (ADR 0068).
 * Springs are their own category (ADR 0069): they are neither route nor
 * hazard, and an author looking for one is looking for exactly them.
 */
const CATEGORY_RULES: CategoryRules = [
  [/^(floor_wood|platform_wood|platform|barrier|pillar|structure|strut|bracing|pipe)_/, "platform"],
  [/^(spring|spring_pad)$/, "spring"],
  [/^(ball|bomb|bomb_[AB])$/, "obstacle"],
  [/^(arch|arch_tall|arch_wide|hoop|hoop_angled|signage_finish|signage_finish_wide)$/, "gate"],
  [/^(cone|sign|signage_.*|railing_.*|flag_[ABC])$/, "scenery"],
  [/^(button_base|lever_.*|diamond|heart|star|power)$/, "scenery"],
];

/**
 * Which KayKit Assets are Springs, and how high they throw by default
 * (CONTEXT.md: Spring, ADR 0069) — per stem, like the categories above, never
 * guessed at runtime from a name. The coil stands over a metre tall and reads
 * as the big one; the flat pads are the ordinary hop. A placed Spring always
 * launches, and the Track author retunes any of it per Segment.
 */
const LAUNCH_RULES: LaunchRules = [
  [/^spring$/, LAUNCH_HEIGHT_PRESETS.high],
  [/^spring_pad$/, LAUNCH_HEIGHT_PRESETS.medium],
];

const idFor = (stem: string, variant: (typeof VARIANTS)[number]): string =>
  variant === "neutral" ? `kaykit_${stem}` : `kaykit_${stem}_${variant}`;

const defs: MeasuredDef[] = [];
let multiNode = 0;

for (const variant of VARIANTS) {
  const dir = join(assetsDir, "KayKit_Platformer_Pack_1.0_FREE", "Assets", "gltf", variant);
  const files = readdirSync(dir).filter((f) => f.endsWith(".gltf"));
  // Per folder: the colours share their geometry by design, so a run-wide
  // dedupe would keep only the first colour.
  const seen = new Map<string, string>();

  for (const file of files) {
    const json = JSON.parse(readFileSync(join(dir, file), "utf8")) as Gltf;
    if (json.buffers?.length !== 1 || !json.buffers[0]?.uri) throw new Error(`${file}: want exactly one external buffer`);
    let bin = readFileSync(join(dir, json.buffers[0].uri));
    bin = embedImages(json, dir, bin);
    json.buffers = [{ byteLength: bin.length }];
    const paired = addRolePairs(json);
    if (paired > 2) multiNode += 1;
    // Blender-style duplicates share geometry: keep the first, skip the rest.
    // Hashed as exported, before seating — as the pack placed it, so seating
    // can't merge two pieces that differed only by where they sat.
    const hash = geometryHash(writeGlb(json, bin));
    const stem = file.replace(/\.gltf$/, "").replace(new RegExp(`_${variant}$`), "");
    const id = idFor(stem, variant);
    if (seen.has(hash)) {
      console.log(`  skip ${variant}/${file}: same geometry as ${seen.get(hash)}`);
      continue;
    }
    seen.set(hash, file);

    seatOnPivot(json, bin);
    // Solid parts (ADR 0065) in the seated frame — what a Moving Segment collides as.
    const solid = addSolidNodes(json, bin);
    console.log(`  ${id}: ${describeParts(solid)}`);
    const glb = writeGlb(json, bin);
    writeFileSync(join(assetsDir, `${id}.glb`), glb);
    if (PROMOTED_SOCKETED_IDS.has(id)) continue;
    const { center, half } = measureBounds(glb);
    const launchHeight = launchHeightFor(stem, LAUNCH_RULES);
    defs.push({
      id,
      category: categorize(id, stem, CATEGORY_RULES),
      center,
      half,
      ...(launchHeight === undefined ? {} : { launchHeight }),
    });
  }
}

defs.sort((a, b) => (a.id < b.id ? -1 : 1));
emitDefsFile(
  join(root, "packages", "shared", "src", "track", "kaykitAssetDefs.ts"),
  "KAYKIT_MODULE_DEFS",
  `// GENERATED by \`pnpm convert:kaykit\` — do not hand-edit.\n` +
    `// KayKit, every folder (${defs.length} shapes, textured: neutral + four colours),\n` +
    `// seated on the Asset pivot: footprints measured with the real shared\n` +
    `// reader off the converted bytes. Socketless (free placement, the\n` +
    `// propModule precedent) — sockets come after eyeballing in the builder.\n` +
    `// Re-run the script to regenerate.`,
  defs,
);

console.log(`converted ${defs.length} files (${VARIANTS.join(", ")}; textured), defs written to kaykitAssetDefs.ts`);
if (multiNode > 0) console.log(`  note: ${multiNode} files pair >1 meshed node (all duplicated with roles)`);
