/**
 * DF trap converter (ADR 0116): turns the authored Blender exports into
 * Assets the shared reader accepts, with their Parts cut and their moving
 * Parts given collision proxies.
 *
 * The drop (2026-09-21) is four raw exports with no roles on any node, so
 * none of them loads at all — and three of them have parts that move against
 * each other, which a Segment has never had. This script does what the game
 * needs done to them, and nothing to how they look:
 *
 *   1. CUTTER   Drops the `__CUTTER` boolean helper left on the fragile
 *               block's critical state.
 *   2. REST     Reads each authored clip and puts its nodes in the rest pose
 *               the simulation will swing them from — a Spin rests where its
 *               clip starts, a Swing in the middle of its range (that is what
 *               ADR 0061 swings either side of), a gate shut. The numbers it
 *               reads are PRINTED, never written: they belong in
 *               `dfAssetDefs.ts` and `tuning/`, where an author can move them.
 *   3. PARTS    Cuts the file into Parts by node-name prefix, from the table
 *               below. A prefix that matches nothing fails the conversion: a
 *               sweeper whose base silently spins is the failure this guards.
 *   4. ROLES    Duplicates every Part into a collision and a visual subtree
 *               over the same mesh bytes, each node stamped with its role and
 *               its Part.
 *   5. SEAT     X/Z centred on the Asset pivot, resting on y = 0.
 *   6. SOLIDS   ADR 0065 solid parts, fitted per Part from that Part's own
 *               collision — what a moving or gated body collides as, because
 *               a trimesh on a body that moves traps whatever gets inside it.
 *
 * The clips themselves are dropped from the output. Nothing in the game plays
 * an Asset's clip (the Character owns the only `AnimationMixer`), and a pose
 * every Player must agree on cannot come from a playback one of them is
 * running.
 *
 * Usage:  pnpm convert:df
 *         pnpm convert:df sweeper_2arms          (one id)
 *
 * It prints each file's footprint and derived numbers for `dfAssetDefs.ts`,
 * which stays hand-authored — like `fanAssetDefs.ts`, and for the same
 * reason: four files with four different mechanics are not a pack.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readAssetModel } from "../packages/shared/src/track/asset.js";
import { measureBounds, readGlb, seatOnPivot, writeGlb, type Gltf, type GltfNode } from "./convert-lib.js";
import { describeParts, solidPartsFor, type SolidPartSpec } from "./convert-solids.js";

/** How the authored clip on a Part's root is read (step 2 above). */
type ClipKind =
  /** Endless rotation: rests where the clip starts, gives rad/s. */
  | "spin"
  /** Back and forth: rests at the middle of its range, gives amplitude and period. */
  | "swing"
  /** Shut, open, held, shut: rests shut, gives the open angle, the swing and the hold. */
  | "gate";

interface PartRule {
  /** The `part` extra stamped on this Part's nodes, and the name its def uses. */
  name: string;
  role: "still" | "moving" | "gated";
  /** The node whose subtree is this Part. Omitted on the Part everything else falls into. */
  root?: string;
  /** Several nodes that are one Part — a glove is its mitt and its cuff. Use instead of `root`. */
  roots?: string[];
  clip?: ClipKind;
  /**
   * How this Part's solid proxies are fitted: per authored mesh (the
   * default — a mesh is usually one shape, and fitting the Part as a whole
   * would gather a sweeper's two arms into one blob across the gap), or one
   * box over the whole Part, for an assembly nobody is meant to thread.
   */
  solids?: "fit" | "box";
  /**
   * A Spin's rest pose, in degrees about its axis, when it should not rest
   * where its clip starts. The difference is printed as the Spin's
   * `startAngle`, so Tick 0 still looks the way the clip starts.
   */
  restAngle?: number;
}

interface FileRule {
  /** The authored export, under `assets/DF_source/`. */
  source: string;
  /** The Asset id, which is the output file's stem (ADR 0050). */
  id: string;
  parts: PartRule[];
  /**
   * Node subtrees that are drawn but never collided — a muzzle flash, a
   * crack drawn on a face. They are dropped from the collision copy only, so
   * what a Character stands on never depends on how damaged the piece looks.
   */
  noCollide?: string[];
  /**
   * The same, for every node whose name matches — a model with hundreds of
   * rivets is not a list anyone should keep by hand.
   */
  noCollideMatching?: RegExp;
  /**
   * Nodes whose place in the seated file a def has to be written against — a
   * muzzle, a mount. Printed, never written: they land in `dfAssetDefs.ts`.
   */
  mark?: string[];
  /**
   * Skinned meshes are unbound and left where their bind pose already puts
   * them (ADR 0121). Blender writes these vertices in model space with the
   * inverse bind matrices undoing the joints' rest, so dropping the skin
   * leaves every mesh exactly where the model shows it — checked, not
   * assumed: the converter fails if a mesh would move.
   */
  unskin?: boolean;
  /** Clips to drop before anything else reads them — an earlier iteration left in the file. */
  dropClips?: string[];
  /**
   * A collision box the converter adds, for a walking surface the model does
   * not have one of: a conveyor's deck is 36 slats on a loop, and a Character
   * has to stand on one flat thing rather than thirty-six ridges. Measured
   * from the export and written here, never fitted — what a Character stands
   * on is not a thing to guess at.
   */
  deck?: { center: Vec3; halfExtents: Vec3 };
  /**
   * Node subtrees removed before anything reads the file — a scale
   * reference the artist left standing beside the model.
   */
  drop?: string[];
}

const FILES: FileRule[] = [
  {
    source: "DF_sweeper-2-arms.glb",
    id: "sweeper_2arms",
    parts: [
      { name: "base", role: "still" },
      { name: "rotor", role: "moving", root: "Sweeper_Rotor", clip: "spin" },
    ],
    // The painted stripes lie flush on the drum and on the rotor: as collision
    // they are curved shells, and a curved shell is decomposed into a dozen
    // hulls each. Dropping them costs nothing you can touch and takes the
    // base from 69 solid parts to 4.
    noCollide: [
      ...Array.from({ length: 8 }, (_, i) => `Base_RimStripe_0${i}`),
      ...Array.from({ length: 6 }, (_, i) => `Rotor_Stripe_0${i}`),
    ],
  },
  {
    source: "DF_sweeper_3_arms.glb",
    id: "sweeper_3arms",
    // Three rotors on one tower, each its own Part with its own clip
    // (ADR 0124): low −36°/s, mid +72°/s, high −144°/s.
    parts: [
      { name: "tower", role: "still" },
      // Rested alternately at 0° and 180°, so the three arms' bounds balance
      // about the tower and the pivot convention puts the tower's axis at the
      // origin — one arm is lopsided by design, two opposite ones are not.
      // The clip's own starting angles come back as each Spin's startAngle.
      { name: "low", role: "moving", root: "Low_Rotor", clip: "spin", restAngle: 0 },
      { name: "mid", role: "moving", root: "Mid_Rotor", clip: "spin", restAngle: 180 },
      { name: "high", role: "moving", root: "High_Rotor", clip: "spin", restAngle: 0 },
    ],
    drop: ["ScaleReference_170cm"],
    // Flush with what they sit on: 170 rivets, the bolts and the painted
    // chevrons would each be a proxy of their own, and none of them is
    // anything a Character could touch apart from the arm under it.
    noCollideMatching: /Rivet|_Bolt_|_Chevron_/,
  },
  {
    source: "trap-door.glb",
    id: "trapdoor",
    parts: [
      { name: "frame", role: "still" },
      { name: "left", role: "gated", root: "TrapDoor_Left", clip: "gate" },
      { name: "right", role: "gated", root: "TrapDoor_Right", clip: "gate" },
    ],
  },
  {
    source: "DF_shooter.glb",
    id: "shooter",
    parts: [
      // Every mesh in this file hangs off the yaw pivot, feet included: the
      // whole carriage turns on its base, as authored. There is no still Part.
      { name: "carriage", role: "moving", root: "Shooter_YawPivot", clip: "swing", solids: "box" },
      // The recoil pivot stays inside the barrel Part: a 0.18 m nudge on
      // firing is presentation (ADR 0119), and the node keeps its name for
      // the renderer to find.
      { name: "barrel", role: "moving", root: "Shooter_PitchPivot", clip: "swing", solids: "box" },
    ],
    noCollide: ["Shooter_MuzzleFlash_Inner", "Shooter_MuzzleFlash_Outer"],
    mark: ["Shooter_PitchPivot", "Shooter_MuzzleRing", "Shooter_MuzzleFlash_Outer"],
  },
  {
    source: "DF_belt.glb",
    id: "belt",
    // One piece: the frame, the rollers and the rails. The slats are drawn
    // riding their loop (ADR 0120) and never collided — a Character stands on
    // the deck box below, which is one flat thing instead of 36 ridges.
    parts: [{ name: "frame", role: "still" }],
    noCollide: [
      ...Array.from({ length: 36 }, (_, i) => `Conveyor_Slat_${String(i).padStart(2, "0")}`),
      ...[1, 6, 11, 16, 21, 26, 31].map((n) => `Conveyor_Arrow_${String(n).padStart(2, "0")}`),
    ],
    // Measured: the top run's slats sit at y 1.01–1.13 between the panels
    // (x ±1.04), over the straight span between the rollers (z ±2.1).
    deck: { center: { x: 0, y: 1.04, z: 0 }, halfExtents: { x: 1.04, y: 0.09, z: 2.1 } },
    mark: ["Conveyor_FrontRoller", "Conveyor_BackRoller", "Conveyor_Slat_00"],
  },
  {
    source: "DG_punching_glove.glb",
    id: "punching_glove",
    unskin: true,
    dropClips: ["Puncher_Action_V13"],
    parts: [
      { name: "frame", role: "still" },
      // The fist: gated, because there is no glove at all until it punches
      // (ADR 0121), and what hits you is what you can see.
      { name: "glove", role: "gated", roots: ["Puncher_BoxingMitt", "Puncher_GloveCuff", "Puncher_GloveCuffHighlight"] },
      // Drawn only: a concertina behind the fist, and the button it sits on.
      { name: "bellows", role: "gated", roots: ["Puncher_Bellows"] },
      { name: "button", role: "gated", roots: ["Puncher_IdleButton", "Puncher_IdleButtonBase"] },
    ],
    noCollide: ["Puncher_Bellows", "Puncher_IdleButton", "Puncher_IdleButtonBase", "Puncher_GloveCuffHighlight"],
    mark: ["Glove", "Bellows", "Button"],
  },
  {
    source: "fragile-block.glb",
    id: "fragile_block",
    // One body in three authored looks (ADR 0118): what a Character stands on
    // is the same box however cracked it is, so the states are not Parts —
    // and only the intact state collides, so the cracks and the loose chips
    // never become something to trip over.
    parts: [{ name: "block", role: "still" }],
    noCollide: ["FragileBlock_State1_Damaged", "FragileBlock_State2_Critical"],
  },
];

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assets = join(root, "assets");
const sources = join(assets, "DF_source");

type Vec3 = { x: number; y: number; z: number };
type Quat = [number, number, number, number];

type SourceJson = Gltf & {
  accessors?: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string }[];
  animations?: { name?: string; channels: { sampler: number; target: { node?: number; path: string } }[]; samplers: { input: number; output: number }[] }[];
  materials?: { name?: string }[];
  meshes?: { name?: string; primitives: { attributes: Record<string, number>; indices?: number; material?: number }[] }[];
};

const FLOAT = 5126;
const USHORT = 5123;
const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC3: 3, VEC4: 4 };

/** One accessor's floats, row by row. Animation data is float in every file here; anything else is a surprise worth failing on. */
const readAccessor = (json: SourceJson, bin: Buffer, index: number): number[][] => {
  const accessor = json.accessors?.[index];
  if (!accessor) throw new Error(`accessor ${index} does not exist`);
  if (accessor.componentType !== FLOAT) throw new Error(`accessor ${index} is not float data`);
  const view = json.bufferViews?.[accessor.bufferView ?? -1];
  if (!view) throw new Error(`accessor ${index} has no bufferView`);
  const size = COMPONENTS[accessor.type]!;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const rows: number[][] = [];
  for (let i = 0; i < accessor.count; i += 1) {
    const row: number[] = [];
    for (let c = 0; c < size; c += 1) row.push(bin.readFloatLE(start + (i * size + c) * 4));
    rows.push(row);
  }
  return rows;
};

/** The angle a rotation quaternion turns through about `axis`, signed, in radians. */
const angleAbout = (q: number[], axis: Vec3): number =>
  2 * Math.atan2(q[0]! * axis.x + q[1]! * axis.y + q[2]! * axis.z, q[3]!);

/** The axis a rotation track turns about — the sample furthest from identity, normalized. */
const trackAxis = (samples: number[][]): Vec3 => {
  let best = samples[0]!;
  let bestLength = 0;
  for (const q of samples) {
    const length = Math.hypot(q[0]!, q[1]!, q[2]!);
    if (length > bestLength) {
      bestLength = length;
      best = q;
    }
  }
  if (bestLength < 1e-6) throw new Error("rotation track never leaves identity");
  return { x: best[0]! / bestLength, y: best[1]! / bestLength, z: best[2]! / bestLength };
};

const quatAbout = (axis: Vec3, angle: number): Quat => {
  const s = Math.sin(angle / 2);
  return [axis.x * s, axis.y * s, axis.z * s, Math.cos(angle / 2)];
};

const deg = (radians: number): string => `${((radians * 180) / Math.PI).toFixed(1)}°`;

interface DerivedClip {
  part: string;
  /** What to print under the file, for `dfAssetDefs.ts` to be written from. */
  lines: string[];
}

/**
 * Put one Part's root in its rest pose and read the clip's numbers off it
 * (step 2). Returns nothing to write — every number here is printed, because
 * a feel number that lives in a generated file is a number nobody can tune.
 */
const restPart = (json: SourceJson, bin: Buffer, rule: PartRule, nodeIndex: number): DerivedClip | undefined => {
  if (!rule.clip) {
    // No clip: rest is the identity the file was authored from (a recoil
    // pivot saved mid-shot would otherwise sit back for ever).
    const node = json.nodes![nodeIndex]!;
    node.translation = [0, 0, 0];
    node.rotation = [0, 0, 0, 1];
    return undefined;
  }
  const channels = (json.animations ?? [])
    .flatMap((animation) => animation.channels.map((channel) => ({ animation, channel })))
    .filter(({ channel }) => channel.target.node === nodeIndex && channel.target.path === "rotation");
  if (channels.length === 0) throw new Error(`part "${rule.name}": node "${rule.root}" carries no rotation clip to read`);
  const { animation, channel } = channels[0]!;
  const sampler = animation.samplers[channel.sampler]!;
  const times = readAccessor(json, bin, sampler.input).map((row) => row[0]!);
  const samples = readAccessor(json, bin, sampler.output);
  const axis = trackAxis(samples);
  const angles = samples.map((q) => angleAbout(q, axis));
  const duration = times[times.length - 1]! - times[0]! + (times[1]! - times[0]!);
  const node = json.nodes![nodeIndex]!;
  const lines: string[] = [];

  if (rule.clip === "spin") {
    // Its own first sample is the rest pose. The rate is however far the
    // clip actually turns, unwrapped sample by sample about one fixed axis —
    // a clip may turn several times, and either way (the three-arm
    // sweeper's rotors turn −1, +2 and −4 times in theirs).
    const flip = axis.x + axis.y + axis.z < 0 ? -1 : 1;
    const about = { x: flip * axis.x, y: flip * axis.y, z: flip * axis.z };
    node.rotation = rule.restAngle === undefined ? (samples[0]!.slice(0, 4) as Quat) : quatAbout(about, (rule.restAngle * Math.PI) / 180);
    let turned = 0;
    for (let i = 1; i < samples.length; i += 1) {
      let step = angleAbout(samples[i]!, about) - angleAbout(samples[i - 1]!, about);
      step -= 2 * Math.PI * Math.round(step / (2 * Math.PI));
      turned += step;
    }
    const span = times[times.length - 1]! - times[0]!;
    const speed = turned / span;
    lines.push(
      `spin about (${about.x.toFixed(2)}, ${about.y.toFixed(2)}, ${about.z.toFixed(2)}) at ${speed.toFixed(4)} rad/s ` +
        `(${deg(speed)}/s, ${(turned / (2 * Math.PI)).toFixed(2)} turns in ${span.toFixed(2)} s)`,
    );
    if (rule.restAngle !== undefined) {
      let start = angleAbout(samples[0]!, about) - (rule.restAngle * Math.PI) / 180;
      start -= 2 * Math.PI * Math.round(start / (2 * Math.PI));
      lines.push(`rested at ${rule.restAngle}°, so startAngle ${start.toFixed(4)} rad (${deg(start)}) puts Tick 0 where the clip starts`);
    }
    return { part: rule.name, lines };
  }

  const min = Math.min(...angles);
  const max = Math.max(...angles);

  if (rule.clip === "swing") {
    // ADR 0061 swings ±amplitude either side of the rest pose, so the rest
    // pose is the middle of the authored range — not where the file was saved.
    const middle = (min + max) / 2;
    const amplitude = (max - min) / 2;
    node.rotation = quatAbout(axis, middle);
    lines.push(
      `swing about (${axis.x.toFixed(2)}, ${axis.y.toFixed(2)}, ${axis.z.toFixed(2)}) ` +
        `${deg(amplitude)} either side of ${deg(middle)}, period ${duration.toFixed(2)} s ` +
        `(authored range ${deg(min)} … ${deg(max)})`,
    );
    return { part: rule.name, lines };
  }

  // A gate rests shut: the end of the range nearest zero.
  const openAngle = Math.abs(max) > Math.abs(min) ? max : min;
  node.rotation = [0, 0, 0, 1];
  const openIndex = angles.findIndex((angle) => Math.abs(angle - openAngle) < 1e-3);
  const closeIndex = angles.length - 1 - [...angles].reverse().findIndex((angle) => Math.abs(angle - openAngle) < 1e-3);
  lines.push(
    `gate about (${axis.x.toFixed(2)}, ${axis.y.toFixed(2)}, ${axis.z.toFixed(2)}) opening ${deg(openAngle)}, ` +
      `swing ${times[openIndex]!.toFixed(2)} s, held ${(times[closeIndex]! - times[openIndex]!).toFixed(2)} s, ` +
      `cycle ${duration.toFixed(2)} s`,
  );
  // The authored curve itself, for the def to replay (ADR 0117): the clip's
  // own samples, in the opening direction, at its own uniform step — so what
  // the simulation poses is what was keyframed, not a re-modelled guess.
  const step = times[1]! - times[0]!;
  const sign = openAngle < 0 ? -1 : 1;
  const curve = [0, ...angles.map((angle) => sign * angle)];
  lines.push(`curve step ${step.toFixed(4)} s, ${curve.length} samples, open ${Math.abs(openAngle).toFixed(4)} rad:`);
  lines.push(`  [${curve.map((angle) => angle.toFixed(4)).join(", ")}]`);
  return { part: rule.name, lines };
};

/** Every node index of the file, by name — names are unique in all four exports, and a duplicate is worth failing on. */
const indexByName = (json: SourceJson): Map<string, number> => {
  const byName = new Map<string, number>();
  (json.nodes ?? []).forEach((node, index) => {
    const name = node.name;
    if (name === undefined) return;
    if (byName.has(name)) throw new Error(`two nodes are named "${name}" — the Part table addresses nodes by name`);
    byName.set(name, index);
  });
  return byName;
};

/** Drop primitives drawn with a boolean helper material, and any mesh left empty. */
const dropCutter = (json: SourceJson): number => {
  const cutters = new Set((json.materials ?? []).flatMap((material, index) => (material.name === "__CUTTER" ? [index] : [])));
  if (cutters.size === 0) return 0;
  let dropped = 0;
  for (const mesh of json.meshes ?? []) {
    const kept = mesh.primitives.filter((primitive) => primitive.material === undefined || !cutters.has(primitive.material));
    dropped += mesh.primitives.length - kept.length;
    mesh.primitives = kept;
  }
  if ((json.meshes ?? []).some((mesh) => mesh.primitives.length === 0)) {
    throw new Error("a mesh is nothing but its __CUTTER primitives — drop the object in Blender instead");
  }
  return dropped;
};

/**
 * Which Part each node belongs to (step 3): a Part's root and everything
 * under it, until a nested Part's root takes over. Nodes above every root
 * fall into the rule with no root of its own.
 */
const assignParts = (json: SourceJson, rule: FileRule, byName: Map<string, number>): Map<number, string> => {
  const rootOf = new Map<number, PartRule>();
  for (const part of rule.parts) {
    for (const name of part.roots ?? (part.root === undefined ? [] : [part.root])) {
      const index = byName.get(name);
      if (index === undefined) throw new Error(`part "${part.name}": no node named "${name}" — the export was renamed`);
      rootOf.set(index, part);
    }
  }
  const fallback = rule.parts.find((part) => part.root === undefined && part.roots === undefined);
  const partOf = new Map<number, string>();
  const visit = (index: number, carried: string | undefined): void => {
    const here = rootOf.get(index)?.name ?? carried;
    const node = json.nodes![index]!;
    if (node.mesh !== undefined) {
      if (here === undefined) throw new Error(`node "${node.name}" belongs to no Part and the file declares no fallback`);
      partOf.set(index, here);
    } else if (here !== undefined) {
      partOf.set(index, here);
    }
    for (const child of node.children ?? []) visit(child, here);
  };
  for (const index of json.scenes?.[0]?.nodes ?? []) visit(index, fallback?.name);
  return partOf;
};

/**
 * Duplicate every scene root into a collision and a visual subtree over the
 * same mesh bytes (step 4), stamping each node with its role and its Part.
 * A variant of `convert-lib`'s `addRolePairs`, which knows nothing of Parts.
 */
const addRolePairsWithParts = (json: SourceJson, partOf: Map<number, string>, noCollide: Set<string>): number => {
  const source = json.nodes ?? [];
  const out: GltfNode[] = [];
  let paired = 0;
  const copy = (index: number, role: "collision" | "visual"): number => {
    const node = source[index]!;
    if (role === "collision" && node.name !== undefined && noCollide.has(node.name)) return -1;
    const at = out.length;
    const made: GltfNode = { ...node };
    delete made.children;
    const part = partOf.get(index);
    if (node.mesh !== undefined) {
      paired += 1;
      made.name = `${node.name ?? "node"}_${role}`;
      made.extras = { ...(node.extras ?? {}), role, ...(part === undefined ? {} : { part }) };
    } else if (part !== undefined) {
      made.extras = { ...(node.extras ?? {}), part };
    }
    out.push(made);
    const kids = (node.children ?? []).map((child) => copy(child, role)).filter((child) => child >= 0);
    if (kids.length > 0) made.children = kids;
    return at;
  };
  const scene = json.scenes?.[0];
  if (!scene) throw new Error("no scene");
  scene.nodes = (scene.nodes ?? []).flatMap((index) => [copy(index, "collision"), copy(index, "visual")]).filter((index) => index >= 0);
  json.nodes = out;
  json.scenes = [scene];
  return paired;
};

/**
 * ADR 0065 solid parts, fitted per Part (step 6) — a moving or gated body
 * collides as these, never as its hollow trimesh. Each one is stamped with
 * its Part, so `resolveTrack` can hand a body its own shapes and no others.
 */
const addPartSolidNodes = (json: SourceJson, bin: Buffer, wanted: Map<string, "fit" | "box">): Map<string, SolidPartSpec[]> => {
  const model = readAssetModel(new Uint8Array(writeGlb(json, bin)));
  const byPart = new Map<string, SolidPartSpec[]>();
  const boxed = new Map<string, { min: Vec3; max: Vec3 }>();
  for (const mesh of model.collision) {
    if (mesh.part === undefined || !wanted.has(mesh.part)) continue;
    if (wanted.get(mesh.part) === "box") {
      const bounds = boxed.get(mesh.part) ?? {
        min: { x: Infinity, y: Infinity, z: Infinity },
        max: { x: -Infinity, y: -Infinity, z: -Infinity },
      };
      for (const p of mesh.positions) {
        bounds.min = { x: Math.min(bounds.min.x, p.x), y: Math.min(bounds.min.y, p.y), z: Math.min(bounds.min.z, p.z) };
        bounds.max = { x: Math.max(bounds.max.x, p.x), y: Math.max(bounds.max.y, p.y), z: Math.max(bounds.max.z, p.z) };
      }
      boxed.set(mesh.part, bounds);
      continue;
    }
    const parts = byPart.get(mesh.part) ?? [];
    // Fitted per authored mesh, not over the Part as a whole: a Part's small
    // pieces gathered into one hull would span both of a sweeper's arms and
    // fill the gap a Character runs through.
    parts.push(...solidPartsFor(mesh.positions, mesh.indices));
    byPart.set(mesh.part, parts);
  }
  const round = (n: number): number => Number(n.toFixed(4)) || 0;
  for (const [part, bounds] of boxed) {
    byPart.set(part, [
      {
        shape: {
          type: "box",
          halfExtents: {
            x: round((bounds.max.x - bounds.min.x) / 2),
            y: round((bounds.max.y - bounds.min.y) / 2),
            z: round((bounds.max.z - bounds.min.z) / 2),
          },
        },
        position: {
          x: round((bounds.max.x + bounds.min.x) / 2),
          y: round((bounds.max.y + bounds.min.y) / 2),
          z: round((bounds.max.z + bounds.min.z) / 2),
        },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
      },
    ]);
  }
  const nodes = json.nodes!;
  const scene = json.scenes![0]!;
  for (const [part, specs] of byPart) {
    specs.forEach((spec, i) => {
      const shape =
        spec.shape.type === "hull"
          ? { type: "hull", points: spec.shape.points.flatMap((p) => [p.x, p.y, p.z]) }
          : spec.shape.type === "box"
            ? { type: "box", halfExtents: [spec.shape.halfExtents.x, spec.shape.halfExtents.y, spec.shape.halfExtents.z] }
            : spec.shape;
      const node: GltfNode = { name: `solid_${part}_${i}_${spec.shape.type}`, extras: { role: "solid", part, shape } };
      if (spec.position.x !== 0 || spec.position.y !== 0 || spec.position.z !== 0) {
        node.translation = [spec.position.x, spec.position.y, spec.position.z];
      }
      if (spec.rotation.w !== 1) node.rotation = [spec.rotation.x, spec.rotation.y, spec.rotation.z, spec.rotation.w];
      scene.nodes = [...(scene.nodes ?? []), nodes.length];
      nodes.push(node);
    });
  }
  return byPart;
};

/** Turn `p` by the rotation quaternion `q`. */
const turn = (q: Quat, p: Vec3): Vec3 => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * p.z - z * p.y);
  const ty = 2 * (z * p.x - x * p.z);
  const tz = 2 * (x * p.y - y * p.x);
  return { x: p.x + w * tx + (y * tz - z * ty), y: p.y + w * ty + (z * tx - x * tz), z: p.z + w * tz + (x * ty - y * tx) };
};

const mulQuats = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

/**
 * Unbind every skinned mesh (ADR 0121). Blender writes a rigidly bound mesh
 * in model space with the inverse bind matrix undoing its joint's rest, so
 * the vertices are already where the model shows them and dropping the skin
 * is the whole of it. A node that carries its own transform as well would
 * move, so that case fails rather than shifting geometry quietly.
 */
const unskin = (json: SourceJson): void => {
  for (const node of json.nodes ?? []) {
    if (node.skin === undefined) continue;
    if (node.translation || node.rotation || node.scale) {
      throw new Error(`node "${node.name}" is skinned and also placed — unbinding it would move it`);
    }
    delete node.skin;
  }
  delete (json as Record<string, unknown>).skins;
};

/** A node's origin in the file's own frame, walked down from the scene roots through every transform. */
const worldOrigin = (json: SourceJson, target: GltfNode): Vec3 => {
  const nodes = json.nodes ?? [];
  const found = { x: 0, y: 0, z: 0 };
  const visit = (index: number, at: Vec3, rotation: Quat): void => {
    const node = nodes[index]!;
    const t = node.translation ?? [0, 0, 0];
    const here = addV(at, turn(rotation, { x: t[0], y: t[1], z: t[2] }));
    const q = mulQuats(rotation, (node.rotation ?? [0, 0, 0, 1]) as Quat);
    if (node === target) {
      found.x = here.x;
      found.y = here.y;
      found.z = here.z;
    }
    for (const child of node.children ?? []) visit(child, here, q);
  };
  for (const index of json.scenes?.[0]?.nodes ?? []) visit(index, { x: 0, y: 0, z: 0 }, [0, 0, 0, 1]);
  return found;
};

const addV = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });


/**
 * Add one closed, outward-wound box as a collision mesh (see {@link FileRule.deck}).
 * Written as a mesh rather than a `role: "solid"` node because a still Part's
 * collision is its trimesh, and this one has to be what a Character walks on.
 */
const addDeckBox = (json: SourceJson, bin: Buffer, box: { center: Vec3; halfExtents: Vec3 }, part: string): Buffer => {
  const { center: c, halfExtents: h } = box;
  const corners = [
    [c.x - h.x, c.y - h.y, c.z - h.z],
    [c.x + h.x, c.y - h.y, c.z - h.z],
    [c.x + h.x, c.y + h.y, c.z - h.z],
    [c.x - h.x, c.y + h.y, c.z - h.z],
    [c.x - h.x, c.y - h.y, c.z + h.z],
    [c.x + h.x, c.y - h.y, c.z + h.z],
    [c.x + h.x, c.y + h.y, c.z + h.z],
    [c.x - h.x, c.y + h.y, c.z + h.z],
  ];
  // Counter-clockwise seen from outside, so `TriMeshFlags.ORIENTED` faces out.
  const faces = [
    [0, 2, 1], [0, 3, 2],
    [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4],
    [3, 7, 6], [3, 6, 2],
    [0, 4, 7], [0, 7, 3],
    [1, 2, 6], [1, 6, 5],
  ];
  const positions = Buffer.alloc(corners.length * 12);
  corners.forEach((p, i) => p.forEach((v, k) => positions.writeFloatLE(v, i * 12 + k * 4)));
  const indices = Buffer.alloc(faces.length * 6);
  faces.flat().forEach((v, i) => indices.writeUInt16LE(v, i * 2));

  const views = (json.bufferViews ??= []);
  const positionView = views.push({ buffer: 0, byteOffset: bin.length, byteLength: positions.length }) - 1;
  const indexView = views.push({ buffer: 0, byteOffset: bin.length + positions.length, byteLength: indices.length }) - 1;
  const accessors = (json.accessors ??= []);
  const min = [c.x - h.x, c.y - h.y, c.z - h.z];
  const max = [c.x + h.x, c.y + h.y, c.z + h.z];
  const positionAccessor =
    accessors.push({ bufferView: positionView, componentType: FLOAT, count: corners.length, type: "VEC3", min, max } as never) - 1;
  const indexAccessor = accessors.push({ bufferView: indexView, componentType: USHORT, count: faces.length * 3, type: "SCALAR" } as never) - 1;
  const meshes = (json.meshes ??= []);
  const mesh = meshes.push({ name: "Conveyor_Deck", primitives: [{ attributes: { POSITION: positionAccessor }, indices: indexAccessor }] }) - 1;
  const nodes = (json.nodes ??= []);
  json.scenes![0]!.nodes = [...(json.scenes![0]!.nodes ?? []), nodes.length];
  nodes.push({ name: "Conveyor_Deck_collision", mesh, extras: { role: "collision", part } });
  return Buffer.concat([bin, positions, indices, Buffer.alloc((4 - ((positions.length + indices.length) % 4)) % 4)]);
};

/**
 * The punch, as its clip keyframes it (ADR 0121): how far the fist reaches
 * along +Z, and the scale of each thing that grows — the glove itself, the
 * bellows behind it, the button under it. Printed for `dfAssetDefs.ts`, like
 * every other curve in this converter.
 */
const printPunchCurve = (json: SourceJson, bin: Buffer): void => {
  const clip = json.animations?.[0];
  if (!clip) return;
  const names = (json.nodes ?? []).map((node) => node.name);
  const channelFor = (node: string, path: string) =>
    clip.channels.find((channel) => names[channel.target.node ?? -1] === node && channel.target.path === path);
  const samples = (node: string, path: string): number[][] | undefined => {
    const channel = channelFor(node, path);
    if (!channel) return undefined;
    return readAccessor(json, bin, clip.samplers[channel.sampler]!.output);
  };
  const times = readAccessor(json, bin, clip.samplers[channelFor("Glove", "translation")!.sampler]!.input).map((row) => row[0]!);
  const reach = samples("Glove", "translation")!.map((row) => row[2]! - 0);
  const glove = samples("Glove", "scale")!.map((row) => (row[0]! + row[1]! + row[2]!) / 3);
  const bellows = samples("Bellows", "scale")!.map((row) => row[1]!);
  const button = samples("Button", "scale")!.map((row) => (row[0]! + row[1]! + row[2]!) / 3);
  const at0 = reach[0]!;
  const round = (n: number) => Number(n.toFixed(4));
  console.log(`  punch: step ${(times[1]! - times[0]!).toFixed(4)} s, ${reach.length} samples, reach ${round(Math.max(...reach) - at0)} m`);
  console.log(`    reach:   [${reach.map((z) => round(z - at0)).join(", ")}]`);
  console.log(`    glove:   [${glove.map(round).join(", ")}]`);
  console.log(`    bellows: [${bellows.map(round).join(", ")}]`);
  console.log(`    button:  [${button.map(round).join(", ")}]`);
};

const convert = (rule: FileRule): void => {
  const { json, bin: originalBin } = readGlb(readFileSync(join(sources, rule.source))) as { json: SourceJson; bin: Buffer };
  let bin = originalBin;
  const byName = indexByName(json);

  const cut = dropCutter(json);
  for (const name of rule.drop ?? []) {
    const index = byName.get(name);
    if (index === undefined) throw new Error(`drop names "${name}", which this export has no node for`);
    const scene = json.scenes?.[0];
    if (scene) scene.nodes = (scene.nodes ?? []).filter((root) => root !== index);
    for (const node of json.nodes ?? []) if (node.children) node.children = node.children.filter((child) => child !== index);
  }
  for (const name of rule.dropClips ?? []) {
    const before = (json.animations ?? []).length;
    json.animations = (json.animations ?? []).filter((clip) => clip.name !== name);
    if (json.animations.length === before) throw new Error(`dropClips names "${name}", which this export has no clip for`);
  }
  if (rule.unskin) unskin(json);
  const derived: DerivedClip[] = [];
  for (const part of rule.parts) {
    if (part.root === undefined) continue;
    const found = restPart(json, bin, part, byName.get(part.root)!);
    if (found) derived.push(found);
  }
  const partOf = assignParts(json, rule, byName);
  // Read before the clips go: what they say lands in the defs (ADR 0116).
  if (rule.id === "punching_glove") printPunchCurve(json, originalBin);
  delete json.animations;
  for (const name of rule.noCollide ?? []) {
    if (!byName.has(name)) throw new Error(`noCollide names "${name}", which this export has no node for`);
  }
  const noCollide = new Set(rule.noCollide ?? []);
  if (rule.noCollideMatching) {
    const matching = [...byName.keys()].filter((name) => rule.noCollideMatching!.test(name));
    if (matching.length === 0) throw new Error(`noCollideMatching ${rule.noCollideMatching} matches no node of this export`);
    for (const name of matching) noCollide.add(name);
  }
  const paired = addRolePairsWithParts(json, partOf, noCollide);
  if (rule.deck) bin = addDeckBox(json, bin, rule.deck, rule.parts[0]!.name);
  seatOnPivot(json, bin);
  // Every Part gets solids, still ones included: a still Asset is still one
  // an author may make a Prop (ADR 0095), and `solidParts.test.ts` holds the
  // line that no committed Asset is left with only a hollow shell to collide
  // as. What a still Part collides as at rest is unchanged — its trimesh.
  const wanted = new Map(rule.parts.map((part) => [part.name, part.solids ?? "fit"] as const));
  const solids = addPartSolidNodes(json, bin, wanted);

  // Where each Part that turns is hinged, in the seated frame — the pivot its
  // def needs, measured rather than read off the export's own numbers (every
  // root moved when the file was seated on its pivot).
  const hinges = new Map<string, Vec3>();
  for (const part of rule.parts) {
    if (part.root === undefined) continue;
    const node = json.nodes!.find((candidate) => candidate.name === `${part.root}_collision` || candidate.name === part.root);
    if (!node) continue;
    hinges.set(part.name, worldOrigin(json, node));
  }
  // Any other node a def has to be written against — a muzzle, a mount.
  const marks = (rule.mark ?? []).map((name) => {
    const node = json.nodes!.find((candidate) => candidate.name === `${name}_visual` || candidate.name === name);
    if (!node) throw new Error(`mark names "${name}", which this export has no node for`);
    return { name, at: worldOrigin(json, node) };
  });

  const glb = writeGlb(json, bin);
  writeFileSync(join(assets, `${rule.id}.glb`), glb);
  const { center, half } = measureBounds(glb);

  console.log(`\n${rule.id}.glb  ←  ${rule.source}`);
  console.log(`  ${paired} meshed nodes paired${cut > 0 ? `, ${cut} __CUTTER primitive(s) dropped` : ""}`);
  console.log(
    `  footprint  bounds: { center: { x: ${center.x}, y: ${center.y}, z: ${center.z} }, ` +
      `halfExtents: { x: ${half.x}, y: ${half.y}, z: ${half.z} } }`,
  );
  for (const { name, at } of marks) {
    console.log(`  mark "${name}" at (${at.x.toFixed(4)}, ${at.y.toFixed(4)}, ${at.z.toFixed(4)})`);
  }
  for (const part of rule.parts) {
    const hinge = hinges.get(part.name);
    const fitted = solids.get(part.name);
    const meshes = [...partOf.values()].filter((name) => name === part.name).length;
    console.log(
      `  part "${part.name}" (${part.role})  ${meshes} node(s)` +
        (fitted ? `, ${fitted.length} solid: ${describeParts(fitted)}` : "") +
        (hinge ? `, hinged at (${hinge.x.toFixed(4)}, ${hinge.y.toFixed(4)}, ${hinge.z.toFixed(4)})` : ""),
    );
    for (const line of derived.find((d) => d.part === part.name)?.lines ?? []) console.log(`      ${line}`);
  }
};

const only = process.argv.slice(2);
for (const rule of FILES) {
  if (only.length > 0 && !only.includes(rule.id)) continue;
  convert(rule);
}
