import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SEGMENT_COLORS, SHOOTER_AMMO, type Segment, type TrackDraft } from "@dont-fall/shared";
import { z } from "zod";
import type { TrackApi } from "../api.js";
import { jsonTool } from "../tools.js";
import {
  assertIndexList,
  CheckpointSchema,
  ConveyorSchema,
  editDraftTrack,
  LAUNCH_HEIGHT_MAX,
  LAUNCH_HEIGHT_MIN,
  MotionSchema,
  Vec3Schema,
} from "./segments.js";

/**
 * The sugar tools (ADR 0114, D6+D11): one Attachment each, every one over an
 * index list, every call atomic. Placement stays raw (`add`/`update`); these
 * are the validated way to dress Segments. What they check is what the API
 * would refuse on write (shapes, conflicts, unknown Modules) — course
 * judgment (gates, orders, finish) stays `validate`'s, so a draft can pass
 * through half-built on its way to whole.
 */

const DRAFT_ID = z.string().min(1).describe("Draft id from create_draft (or list_drafts to resume).");
const INDICES = z
  .array(z.number().int().min(0))
  .min(1)
  .max(500)
  .describe("Get_draft's order; deduped, then dressed — one invalid index writes nothing.");

const withoutTrack = ({ track: _track, ...meta }: TrackDraft): Omit<TrackDraft, "track"> => meta;

const dress = async (
  api: TrackApi,
  draftId: string,
  indices: number[],
  apply: (segment: Segment) => Segment,
): Promise<Omit<TrackDraft, "track"> & { touched: number[] }> => {
  const draft = await editDraftTrack(api, draftId, (track) => {
    const ordered = assertIndexList(track.length, indices, "set");
    return track.map((segment, index) => (ordered.includes(index) ? apply(structuredClone(segment)) : segment));
  });
  return { ...withoutTrack(draft), touched: assertIndexList(draft.track.length, indices, "set") };
};

export const registerSugarTools = (server: McpServer, api: TrackApi): void => {
  jsonTool(
    server,
    "set_surface",
    "Dress decks in a Surface — ice skates, mud drags, bounce throws back — or strip them to none. One deck one Surface; refused beside a Prop.",
    {
      draftId: DRAFT_ID,
      indices: INDICES,
      surface: z.enum(["ice", "mud", "bounce", "none"] as const).describe("Which sheet the decks wear; none takes it off."),
    },
    async ({ draftId, indices, surface }) =>
      dress(api, draftId, indices, (segment) => {
        delete segment.ice;
        delete segment.mud;
        delete segment.bounce;
        if (surface !== "none") segment[surface] = true;
        return segment;
      }),
  );

  jsonTool(
    server,
    "set_motion",
    "Give Segments a Motion (spin/swing/slide, local frame, spin→swing→slide, optional ramp to speed up over the Round) or take it away with null. With part, only that moving Part of a parted Asset (one arm of sweeper_3arms; get_module lists them) — the others keep theirs. A Start, a Checkpoint and a finish sign stay still — validate judges that.",
    {
      draftId: DRAFT_ID,
      indices: INDICES,
      motion: MotionSchema.nullable().describe("The Motion, or null to detach."),
      part: z
        .string()
        .min(1)
        .optional()
        .describe("A moving Part's name: set only that Part's own Motion. Absent: the whole Segment's."),
    },
    async ({ draftId, indices, motion, part }) =>
      dress(api, draftId, indices, (segment) => {
        if (part === undefined) {
          if (motion === null) delete segment.motion;
          else segment.motion = motion;
          return segment;
        }
        const parts = { ...segment.partMotions };
        if (motion === null) delete parts[part];
        else parts[part] = motion;
        if (Object.keys(parts).length > 0) segment.partMotions = parts;
        else delete segment.partMotions;
        return segment;
      }),
  );

  jsonTool(
    server,
    "set_conveyor",
    "Run a belt across Segments (preset speed, local-frame yaw) or stop it with null. The whole Asset carries whoever stands on it.",
    {
      draftId: DRAFT_ID,
      indices: INDICES,
      conveyor: ConveyorSchema.nullable().describe("The belt, or null to detach."),
    },
    async ({ draftId, indices, conveyor }) =>
      dress(api, draftId, indices, (segment) => {
        if (conveyor === null) delete segment.conveyor;
        else segment.conveyor = conveyor;
        return segment;
      }),
  );

  jsonTool(
    server,
    "set_launch",
    "Set how high Segments throw (apex metres) or detach with null. Only Springs throw — storable anywhere, but validate warns where no Spring stands.",
    {
      draftId: DRAFT_ID,
      indices: INDICES,
      height: z
        .number()
        .finite()
        .min(LAUNCH_HEIGHT_MIN)
        .max(LAUNCH_HEIGHT_MAX)
        .nullable()
        .describe(`Apex metres within ${LAUNCH_HEIGHT_MIN}..${LAUNCH_HEIGHT_MAX}, or null to detach.`),
    },
    async ({ draftId, indices, height }) =>
      dress(api, draftId, indices, (segment) => {
        if (height === null) delete segment.launch;
        else segment.launch = { height };
        return segment;
      }),
  );

  jsonTool(
    server,
    "set_trapdoor",
    "Set how often Segments' trap doors run (seconds per cycle, and a head start of 0..1 of a cycle to stagger a row), or detach with null for the Asset's own clock. The shape of the swing is keyframed in the Asset and cannot be set here. Only a trap door has leaves; storable anywhere, and publish refuses a period shorter than the authored swing.",
    {
      draftId: DRAFT_ID,
      indices: INDICES,
      period: z.number().finite().positive().nullable().describe("Seconds per cycle, or null to detach and run the Asset's own."),
      phase: z.number().finite().min(0).lt(1).optional().describe("Fraction of a cycle this one is ahead by (0..1)."),
    },
    async ({ draftId, indices, period, phase }) =>
      dress(api, draftId, indices, (segment) => {
        if (period === null) delete segment.trapdoor;
        else segment.trapdoor = { period, ...(phase === undefined || phase === 0 ? {} : { phase }) };
        return segment;
      }),
  );

  jsonTool(
    server,
    "set_fragile",
    "Set how long Segments' fragile floors stay gone once broken (seconds; 0 never brings them back), or detach with null for the Asset's own delay. How many arrivals break one is authored in the Asset — one per drawn look — and cannot be set here. Only a fragile Asset breaks; storable anywhere.",
    {
      draftId: DRAFT_ID,
      indices: INDICES,
      returnSeconds: z.number().finite().min(0).nullable().describe("Seconds before it returns intact, 0 for never, or null to detach."),
    },
    async ({ draftId, indices, returnSeconds }) =>
      dress(api, draftId, indices, (segment) => {
        if (returnSeconds === null) delete segment.fragile;
        else segment.fragile = { returnSeconds };
        return segment;
      }),
  );

  jsonTool(
    server,
    "set_bomb",
    "Set Segments' bombs' fuse (seconds from the pick-up that lights it to the blast) and return (seconds a spent bomb is gone before it lies where it was placed again), or detach with null for the Asset's own clock. Only a bomb Asset (bomb_A, bomb_B) is one; it is always a Prop and needs no set_prop. The warning's fast tick and the blast's reach are the game's, not the Segment's.",
    {
      draftId: DRAFT_ID,
      indices: INDICES,
      fuseSeconds: z.number().finite().positive().nullable().describe("Seconds of fuse, or null to detach the whole timing."),
      returnSeconds: z.number().finite().positive().optional().describe("Seconds a spent bomb is gone."),
    },
    async ({ draftId, indices, fuseSeconds, returnSeconds }) =>
      dress(api, draftId, indices, (segment) => {
        if (fuseSeconds === null) delete segment.bomb;
        else segment.bomb = { fuseSeconds, ...(returnSeconds === undefined ? {} : { returnSeconds }) };
        return segment;
      }),
  );

  jsonTool(
    server,
    "set_shooter",
    "Set what Segments' cannons fire: balls or bombs, seconds between shots, muzzle speed (units/s), and how long a ball lasts (a bomb's fuse) — or detach with null for the Asset's own numbers. Period and life decide how many are in the air at once (ceil(life/period)), which publish caps. Where the muzzle is and how wide it sweeps are the Asset's. A spent ball is never taken away by hitting someone; it keeps rolling. A bomb leaves lit (3 s fuse unless lifeSeconds says otherwise), knocks down what it hits like a ball, can be caught and thrown back, and goes off wherever it is when the fuse runs out.",
    {
      draftId: DRAFT_ID,
      indices: INDICES,
      periodSeconds: z.number().finite().positive().nullable().describe("Seconds between shots, or null to detach the whole timing."),
      ammo: z.enum(SHOOTER_AMMO).optional().describe("What it fires: ball (the default) or bomb."),
      speed: z.number().finite().positive().optional().describe("Muzzle speed in units per second."),
      lifeSeconds: z.number().finite().positive().optional().describe("Seconds a ball lasts before it is taken away — with bombs, each bomb's fuse."),
      yawDegrees: z.number().finite().min(0).max(180).optional().describe("How far it sweeps side to side, either side of rest; 0 holds it still."),
      yawSeconds: z.number().finite().positive().optional().describe("Seconds for one sweep side to side and back."),
      pitchDegrees: z.number().finite().min(0).max(180).optional().describe("How far it sweeps up and down; 0 holds it still."),
      pitchSeconds: z.number().finite().positive().optional().describe("Seconds for one sweep up and down and back."),
    },
    async ({ draftId, indices, periodSeconds, ammo, speed, lifeSeconds, yawDegrees, yawSeconds, pitchDegrees, pitchSeconds }) =>
      dress(api, draftId, indices, (segment) => {
        if (periodSeconds === null) delete segment.shooter;
        else {
          segment.shooter = {
            ...(ammo === "bomb" ? { ammo } : {}),
            periodSeconds,
            ...(speed === undefined ? {} : { speed }),
            ...(lifeSeconds === undefined ? {} : { lifeSeconds }),
            ...(yawDegrees === undefined ? {} : { yawDegrees }),
            ...(yawSeconds === undefined ? {} : { yawSeconds }),
            ...(pitchDegrees === undefined ? {} : { pitchDegrees }),
            ...(pitchSeconds === undefined ? {} : { pitchSeconds }),
          };
        }
        return segment;
      }),
  );

  jsonTool(
    server,
    "set_punch",
    "Set when Segments' punching gloves swing: seconds per cycle, a head start of 0..1 of a cycle, and how much faster than authored the swing plays — or detach with null for the Asset's own clock. The shape of the punch is keyframed in the Asset. The speed multiplier is what decides a knockdown: the authored swing only shoves, about 2.5x and up knocks down, through the rule every Moving Segment goes through.",
    {
      draftId: DRAFT_ID,
      indices: INDICES,
      period: z.number().finite().positive().nullable().describe("Seconds per cycle, or null to detach and run the Asset's own."),
      phase: z.number().finite().min(0).lt(1).optional().describe("Fraction of a cycle this one is ahead by (0..1)."),
      rate: z.number().finite().positive().optional().describe("How much faster than authored the swing plays."),
    },
    async ({ draftId, indices, period, phase, rate }) =>
      dress(api, draftId, indices, (segment) => {
        if (period === null) delete segment.punch;
        else {
          segment.punch = {
            period,
            ...(phase === undefined || phase === 0 ? {} : { phase }),
            ...(rate === undefined ? {} : { rate }),
          };
        }
        return segment;
      }),
  );

  jsonTool(
    server,
    "set_prop",
    "Turn Segments into Props (dynamic bodies physics owns) or back into placed scenery. A Prop is nothing else — refused beside every behavioral attachment, paint rides.",
    {
      draftId: DRAFT_ID,
      indices: INDICES,
      prop: z.boolean().describe("true shoves it loose, false places it still."),
    },
    async ({ draftId, indices, prop }) =>
      dress(api, draftId, indices, (segment) => {
        if (prop) segment.prop = true;
        else delete segment.prop;
        return segment;
      }),
  );

  jsonTool(
    server,
    "set_paint",
    "Paint Segments a hue, or null for the file's own look. Purely visual — the one attachment that rides on a Prop.",
    {
      draftId: DRAFT_ID,
      indices: INDICES,
      color: z.enum(SEGMENT_COLORS).nullable().describe("A hue, or null for the file's own look."),
    },
    async ({ draftId, indices, color }) =>
      dress(api, draftId, indices, (segment) => {
        if (color === null) delete segment.color;
        else segment.color = color;
        return segment;
      }),
  );

  jsonTool(
    server,
    "set_course",
    "Mark the course: the Start (one per Track — marking moves it), Checkpoint numbers on gates, or strip marks with clearCourse. Duplicate orders fail naming both Segments.",
    {
      draftId: DRAFT_ID,
      start: z.number().int().min(0).optional().describe("Index to mark as the Start; unmarks any other."),
      clearStart: z.boolean().optional().describe("Unmark the Start, wherever it stands."),
      checkpoints: z
        .array(
          z
            .object({
              index: z.number().int().min(0).describe("Which Segment (get_draft's order)."),
              order: CheckpointSchema.shape.order,
              respawn: Vec3Schema.optional().describe(
                "Floor spot a Respawn stands on, in the gate Segment's own frame. Absent: past the gate.",
              ),
            })
            .strict(),
        )
        .max(100)
        .optional()
        .describe("Checkpoints to switch on; each order once."),
      clearCourse: z
        .array(z.number().int().min(0))
        .max(500)
        .optional()
        .describe("Indices stripped of Start and Checkpoint both."),
    },
    async ({ draftId, start, clearStart, checkpoints, clearCourse }) =>
      withoutTrack(
        await editDraftTrack(api, draftId, (track) => {
          if (start !== undefined && clearStart === true) {
            throw new Error("set_course: start and clearStart contradict — mark a Start or clear it, not both");
          }
          const cleared = clearCourse === undefined ? [] : assertIndexList(track.length, clearCourse, "clearCourse");
          if (start !== undefined) assertIndexList(track.length, [start], "start");
          const marks = checkpoints ?? [];
          const touched = new Set<number>();
          for (const mark of marks) {
            assertIndexList(track.length, [mark.index], "checkpoints");
            if (touched.has(mark.index)) throw new Error(`set_course: index ${mark.index} marked twice in one call`);
            touched.add(mark.index);
            if (cleared.includes(mark.index)) {
              throw new Error(`set_course: index ${mark.index} is both cleared and marked — pick one`);
            }
          }
          if (start !== undefined && cleared.includes(start)) {
            throw new Error(`set_course: index ${start} is both cleared and marked as the Start — pick one`);
          }
          const next = track.map((segment) => structuredClone(segment));
          for (const index of cleared) {
            delete next[index]!.start;
            delete next[index]!.checkpoint;
          }
          if (clearStart === true || start !== undefined) {
            for (const segment of next) delete segment.start;
          }
          if (start !== undefined) next[start]!.start = true;
          for (const mark of marks) {
            next[mark.index]!.checkpoint = mark.respawn === undefined ? { order: mark.order } : { order: mark.order, respawn: mark.respawn };
            touched.add(mark.index);
          }
          // A duplicate order this call introduced fails here, naming both —
          // a pre-existing untouched pair is validate's to judge, not this call's.
          const orders = new Map<number, number>();
          for (const [index, segment] of next.entries()) {
            if (segment.checkpoint === undefined) continue;
            const other = orders.get(segment.checkpoint.order);
            if (other !== undefined && (touched.has(index) || touched.has(other))) {
              throw new Error(
                `set_course: Segments ${other} and ${index} are both Checkpoint ${segment.checkpoint.order}`,
              );
            }
            orders.set(segment.checkpoint.order, index);
          }
          return next;
        }),
      ),
  );
};
