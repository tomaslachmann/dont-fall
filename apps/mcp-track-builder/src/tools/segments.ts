import {
  ASSET_PLACEMENT_MODULES,
  attachmentConflictReason,
  CONVEYOR_PRESETS,
  invalidAttachmentReason,
  LAUNCH_HEIGHT_MAX,
  LAUNCH_HEIGHT_MIN,
  MAX_SEGMENT_SCALE,
  MAX_SURVIVOR_TARGET,
  MAX_TIME_LIMIT_MS,
  MIN_SEGMENT_SCALE,
  MIN_SURVIVOR_TARGET,
  MIN_TIME_LIMIT_MS,
  MODULE_LIBRARY,
  MOTION_EASINGS,
  SEGMENT_COLORS,
  type Module,
  type Segment,
  type Track,
  type TrackDraft,
} from "@dont-fall/shared";
import { z } from "zod";
import type { TrackApi } from "../api.js";

/**
 * What every draft-editing tool shares (ADR 0114, D4+D6+D11): the Module
 * registry edits validate against, the zod schemas that are the LLM's
 * authoring contract, and the read-modify-write that makes every batch
 * atomic — one `PUT /drafts/:id/segments` per call, or no write at all.
 */

// Re-exported so sugar tools describe the same bounds the schemas enforce.
export { LAUNCH_HEIGHT_MIN, LAUNCH_HEIGHT_MAX, MIN_SEGMENT_SCALE, MAX_SEGMENT_SCALE };

/**
 * `z.enum` wants a tuple; shared's vocabularies are arrays. This keeps them
 * the single source — a preset added in shared appears in the tool schema
 * with no second list to update.
 */
export const asTuple = <T extends string>(values: readonly T[]): [T, ...T[]] => {
  const [first, ...rest] = values;
  if (first === undefined) throw new Error("asTuple: empty vocabulary");
  return [first, ...rest];
};

/**
 * Every Module id an edit may reference — the same composition the API's
 * publish gate reads (`PUBLISH_MODULES`), composed here from shared so this
 * package never imports `apps/api` outside its tests. Fail-fast only: the API
 * re-checks on write, so a typo names its segment here instead of 400ing
 * there.
 */
export const TRACK_REGISTRY: Record<string, Module> = { ...MODULE_LIBRARY, ...ASSET_PLACEMENT_MODULES };

/** The distinct `moduleId`s in `track` no Module answers to — the API's `unknownModuleIds` over this registry. */
export const unknownModuleIds = (track: Track): string[] => {
  const unknown = new Set<string>();
  for (const segment of track) {
    if (!Object.hasOwn(TRACK_REGISTRY, segment.moduleId)) unknown.add(segment.moduleId);
  }
  return [...unknown];
};

/**
 * The first Segment whose Attachments are not storable, named by index — the
 * API's `invalidTrackAttachmentReason` over shared's own validators, so a
 * refused edit says which Segment and why before anything is written. Shape
 * (`isTrack`) is the zod schemas' job at the tool boundary; course rules
 * (one Start, gates, finish) are `validate`'s — a draft stays half-built
 * until then.
 */
export const invalidEditReason = (track: Track): string | undefined => {
  for (const [index, segment] of track.entries()) {
    const reason = invalidAttachmentReason(segment) ?? attachmentConflictReason(segment);
    if (reason) return `track[${index}].${reason}`;
  }
  const unknown = unknownModuleIds(track);
  if (unknown.length > 0) return `unknown Module id(s): ${unknown.join(", ")}`;
  return undefined;
};

const finite = (what: string): z.ZodNumber => z.number().finite().describe(`A finite ${what}.`);

export const Vec3Schema = z
  .object({ x: finite("x"), y: finite("y"), z: finite("z") })
  .strict()
  .describe("A point {x, y, z} in metres.");

const SpinSchema = z
  .object({
    axis: Vec3Schema.describe("Spin axis, local frame — must be non-zero; the sign of speed gives the direction."),
    pivot: Vec3Schema.describe("The axis passes through here, local frame."),
    speed: finite("number of radians per second").describe("Radians per second, signed."),
    startAngle: finite("number of radians").optional().describe("Radians at Tick 0. Defaults to 0."),
  })
  .strict();

const TimingSchema = z.object({
  period: finite("number of seconds")
    .positive()
    .describe("Seconds for one full cycle: out, pause, back, pause. Must exceed twice pause."),
  easing: z.enum(asTuple(MOTION_EASINGS)).describe("How each leg travels; easeInOut is the pendulum-like default."),
  pause: finite("number of seconds").min(0).optional().describe("Seconds held at each end. Defaults to 0."),
  phase: finite("number").optional().describe("Fraction of a cycle (0–1) this one is ahead by. Defaults to 0."),
});

const SwingSchema = TimingSchema.extend({
  axis: Vec3Schema.describe("Swing axis, local frame — must be non-zero."),
  pivot: Vec3Schema.describe("The axis passes through here, local frame."),
  amplitude: finite("number of radians").describe("Radians either side of the rest pose."),
}).strict();

const SlideSchema = TimingSchema.extend({
  offset: Vec3Schema.describe("Local-frame vector from the rest pose to the far pose."),
}).strict();

export const MotionSchema = z
  .object({
    spin: SpinSchema.optional().describe("Endless rotation at constant speed."),
    swing: SwingSchema.optional().describe("Rotation back and forth between −amplitude and +amplitude."),
    slide: SlideSchema.optional().describe("Movement back and forth between rest and offset."),
  })
  .strict()
  .refine((motion) => motion.spin !== undefined || motion.swing !== undefined || motion.slide !== undefined, {
    message: "motion must have a spin, swing or slide",
  })
  .describe("How the Segment moves, local frame, applied spin→swing→slide. Null detaches it.");

export const ConveyorSchema = z
  .object({
    preset: z.enum(asTuple(CONVEYOR_PRESETS)).describe("Belt speed: slow 2, medium 4, fast 8 u/s against a 6 u/s run."),
    angle: finite("number of radians").describe(
      "Belt yaw in the Segment's local frame; 0 is module forward (−Z, toward the exit side).",
    ),
  })
  .strict()
  .describe("The whole Asset carries whoever stands on it. Null detaches it.");

export const LaunchSchema = z
  .object({
    height: finite("number of metres")
      .min(LAUNCH_HEIGHT_MIN)
      .max(LAUNCH_HEIGHT_MAX)
      .describe(`Apex metres, within ${LAUNCH_HEIGHT_MIN}..${LAUNCH_HEIGHT_MAX}. Aim a Spring by tilting it.`),
  })
  .strict()
  .describe("A Spring's throw height. Only Springs (a def with launch) throw; a placed Spring always launches.");

export const CheckpointSchema = z
  .object({
    order: z.number().int().min(1).describe("Whole number from 1; each order once per Track."),
    respawn: Vec3Schema.optional().describe(
      "Floor spot a Respawn stands on, in the gate Segment's own frame. Absent: the floor just past the gate.",
    ),
  })
  .strict()
  .describe("Switches a hoop or arch on as a Checkpoint. Only checkpoint Gates count.");

const TrueSchema = z.literal(true).describe("Exactly true.");

/**
 * One placed Segment as the tools author it (ADR 0114, D2): raw
 * `moduleId`/`position`/`rotation`, no layout helpers. Strict — an unknown
 * key is a typo, and a Revision is forever, so it fails here rather than
 * storing half of what was meant.
 */
export const SegmentSchema = z
  .object({
    moduleId: z.string().min(1).describe("Module id from list_modules or list_procedural_modules."),
    position: Vec3Schema.describe("World position in metres; KayKit pieces sit ON y=0."),
    rotation: finite("number of radians").describe("World yaw. Tracks chain toward −Z."),
    pitch: finite("number of radians").optional().describe("Additive pitch, defaults to 0."),
    roll: finite("number of radians").optional().describe("Additive roll, defaults to 0."),
    scale: finite("number")
      .min(MIN_SEGMENT_SCALE)
      .max(MAX_SEGMENT_SCALE)
      .optional()
      .describe(`Uniform size, ${MIN_SEGMENT_SCALE}..${MAX_SEGMENT_SCALE}, 1 when absent.`),
    manuallyPlaced: z.boolean().optional().describe("Builder-only: skips socket re-chaining. Leave absent."),
    motion: MotionSchema.optional(),
    conveyor: ConveyorSchema.optional(),
    ice: TrueSchema.optional().describe("Exactly true — the whole deck skates. One deck one Surface."),
    mud: TrueSchema.optional().describe("Exactly true — the whole deck drags. One deck one Surface."),
    bounce: TrueSchema.optional().describe("Exactly true — inflatable skin. One deck one Surface."),
    launch: LaunchSchema.optional(),
    prop: TrueSchema.optional().describe("Exactly true — a dynamic body physics owns. Refused beside behavioral attachments."),
    start: TrueSchema.optional().describe("Exactly true — one per Track at most. A Start stays still."),
    checkpoint: CheckpointSchema.optional(),
    color: z
      .enum(SEGMENT_COLORS)
      .optional()
      .describe("Paint for the Asset's colored parts; absent draws the file's own look. Rides on a Prop."),
  })
  .strict();

export type SegmentInput = z.infer<typeof SegmentSchema>;

/**
 * A patch over one Segment: every placement field replaceable, every
 * Attachment settable or — with explicit null — detachable. Absent leaves the
 * field alone; there is no way to spell "leave me alone" wrong.
 */
export const SegmentPatchSchema = z
  .object({
    moduleId: z.string().min(1).optional(),
    position: Vec3Schema.optional(),
    rotation: finite("number of radians").optional(),
    pitch: finite("number of radians").nullable().optional(),
    roll: finite("number of radians").nullable().optional(),
    scale: finite("number").min(MIN_SEGMENT_SCALE).max(MAX_SEGMENT_SCALE).nullable().optional(),
    manuallyPlaced: z.boolean().nullable().optional(),
    motion: MotionSchema.nullable().optional(),
    conveyor: ConveyorSchema.nullable().optional(),
    ice: z.boolean().nullable().optional().describe("true wears it, false/null takes it off."),
    mud: z.boolean().nullable().optional().describe("true wears it, false/null takes it off."),
    bounce: z.boolean().nullable().optional().describe("true wears it, false/null takes it off."),
    launch: LaunchSchema.nullable().optional(),
    prop: z.boolean().nullable().optional().describe("true makes it a Prop, false/null places it still."),
    start: z.boolean().nullable().optional().describe("true marks it, false/null unmarks it."),
    checkpoint: CheckpointSchema.nullable().optional(),
    color: z.enum(SEGMENT_COLORS).nullable().optional().describe("A hue, or null for the file's own look."),
  })
  .strict();

export type SegmentPatch = z.infer<typeof SegmentPatchSchema>;

export const TimeLimitSchema = z
  .number()
  .int()
  .min(MIN_TIME_LIMIT_MS)
  .max(MAX_TIME_LIMIT_MS)
  .describe(`Round clock in ms, ${MIN_TIME_LIMIT_MS}..${MAX_TIME_LIMIT_MS}.`);

export const SurvivorTargetSchema = z
  .number()
  .int()
  .min(MIN_SURVIVOR_TARGET)
  .max(MAX_SURVIVOR_TARGET)
  .describe(`Players left standing when a Survival Round ends, ${MIN_SURVIVOR_TARGET}..${MAX_SURVIVOR_TARGET}.`);

/** Applies `patch` to `segment`: values replace, null/false-on-flags detach, absent keeps. */
export const applyPatch = (segment: Segment, patch: SegmentPatch): Segment => {
  const next: Record<string, unknown> = { ...segment };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) {
      delete next[key];
      continue;
    }
    // Boolean flags (ice/mud/bounce/prop/start) store exactly-true-or-absent:
    // false detaches like null rather than storing a lying `false`.
    if (value === false && (key === "ice" || key === "mud" || key === "bounce" || key === "prop" || key === "start")) {
      delete next[key];
      continue;
    }
    next[key] = value;
  }
  return next as Segment;
};

/**
 * Checks a plain index list (remove, sugar): whole numbers, in range,
 * deduped — setting the same Segment twice is one set, not an error. Returns
 * them ascending, so callers splice from the back without thinking.
 */
export const assertIndexList = (length: number, indices: readonly number[], what: string): number[] => {
  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index >= length) {
      throw new Error(`${what}: index ${JSON.stringify(index)} is outside 0..${length - 1} (${length} Segments)`);
    }
  }
  return [...new Set(indices)].sort((a, b) => a - b);
};

/**
 * Reads the draft, applies `edit` to a copy of its Segments, validates the
 * whole Track the way the API will, and writes it back in one PUT — every
 * batch atomic (ADR 0114, D11). Anything invalid throws naming the Segment,
 * and nothing is written.
 */
export const editDraftTrack = async (
  api: TrackApi,
  draftId: string,
  edit: (track: Track) => Track,
): Promise<TrackDraft> => {
  const draft = await api.get<TrackDraft>(`/drafts/${draftId}`);
  const next = edit(structuredClone(draft.track));
  const bad = invalidEditReason(next);
  if (bad) throw new Error(bad);
  return api.put<TrackDraft>(`/drafts/${draftId}/segments`, { track: next });
};
