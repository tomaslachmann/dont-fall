import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  DEFAULT_ROUND_TYPE,
  ENVIRONMENT_IDS,
  ROUND_TYPES,
  type Segment,
  type TrackDraft,
  type TrackDraftListing,
} from "@dont-fall/shared";
import { z } from "zod";
import type { TrackApi } from "../api.js";
import { jsonTool, page } from "../tools.js";
import {
  applyPatch,
  assertIndexList,
  asTuple,
  editDraftTrack,
  SegmentPatchSchema,
  SegmentSchema,
  SurvivorTargetSchema,
  TimeLimitSchema,
  type SegmentInput,
  type SegmentPatch,
} from "./segments.js";

/**
 * The draft tools (ADR 0114, D4+D9+D11): the unfinished Track lives on the
 * API, these are the thin client over it. Reads are paged (a Race runs 300+
 * Segments); every write is atomic — one API call per tool call, so a batch
 * lands whole or not at all.
 */

const PAGING = {
  offset: z.number().int().min(0).default(0).describe("Skip this many Segments."),
  limit: z.number().int().min(1).max(200).default(50).describe("Take at most this many Segments."),
};

const DRAFT_ID = z.string().min(1).describe("Draft id from create_draft (or list_drafts to resume).");

const FromSchema = z
  .object({
    trackId: z.string().min(1).describe("Stored Track id from list_tracks."),
    revision: z.number().int().min(1).optional().describe("Pinned Revision; latest when absent."),
  })
  .strict()
  .describe("Branch an existing Revision: its Segments and clock are copied in.");

const DraftMetaSchema = {
  name: z.string().optional().describe("Display name the published Revision carries. Absent: untitled."),
  roundType: z
    .enum(asTuple(ROUND_TYPES))
    .optional()
    .describe(`Which Round this drafts for — validate and publish judge by it. Defaults to "${DEFAULT_ROUND_TYPE}".`),
  timeLimitMs: TimeLimitSchema.optional(),
  survivorTarget: SurvivorTargetSchema.optional(),
  environment: z
    .enum(ENVIRONMENT_IDS)
    .optional()
    .describe("Sky the Round is drawn under. Defaults to the API's when absent."),
};

const withoutMeta = ({ track, ...meta }: TrackDraft): Omit<TrackDraft, "track"> => meta;

export const registerDraftTools = (server: McpServer, api: TrackApi): void => {
  jsonTool(
    server,
    "create_draft",
    "Start an unfinished Track: empty ({roundType}), from explicit Segments, or branched from a stored Revision (from). Half-built is the point — no Start, no finish, no problem until validate/publish.",
    {
      id: z.string().min(1).optional().describe("Explicit id; reusing one resets that draft. Absent: a UUID."),
      track: z.array(SegmentSchema).optional().describe("Explicit Segments. Absent with from: the Revision's own."),
      from: FromSchema.optional(),
      ...DraftMetaSchema,
    },
    async ({ id, track, from, ...meta }) =>
      api.post<{ id: string; created: boolean }>("/drafts", {
        ...(id === undefined ? {} : { id }),
        ...(track === undefined ? {} : { track: track as Segment[] }),
        ...(from === undefined ? {} : { from }),
        ...meta,
      }),
  );

  jsonTool(
    server,
    "list_drafts",
    "Every unfinished draft without Segments (id, name, round type, count, touched) — resume work without downloading it.",
    {},
    async () => ({ drafts: await api.get<TrackDraftListing[]>("/drafts") }),
  );

  jsonTool(
    server,
    "get_draft",
    "One draft's publish metadata plus its Segments paged — never read a 300-Segment Race whole.",
    { draftId: DRAFT_ID, ...PAGING },
    async ({ draftId, offset, limit }) => {
      const draft = await api.get<TrackDraft>(`/drafts/${draftId}`);
      return { ...withoutMeta(draft), segments: page(draft.track, offset, limit) };
    },
  );

  const add = async (draftId: string, segments: SegmentInput[]): Promise<TrackDraft> =>
    editDraftTrack(api, draftId, (track) => [...track, ...(segments as Segment[])]);

  jsonTool(
    server,
    "add_segment",
    "Append one Segment to a draft. Placement stays raw (moduleId/position/rotation, D2) — attachments ride along or land later via the set_* tools.",
    { draftId: DRAFT_ID, segment: SegmentSchema.describe("The Segment to append.") },
    async ({ draftId, segment }) => {
      const draft = await add(draftId, [segment]);
      return { ...withoutMeta(draft), added: [draft.track.length - 1] };
    },
  );

  jsonTool(
    server,
    "add_segments",
    "Append Segments in order, atomically — one invalid entry writes nothing. Cheaper than add_segment in a loop.",
    {
      draftId: DRAFT_ID,
      segments: z.array(SegmentSchema).min(1).max(500).describe("Appended in order; the call lands whole or not at all."),
    },
    async ({ draftId, segments }) => {
      const draft = await add(draftId, segments);
      return {
        ...withoutMeta(draft),
        added: segments.map((_, i) => draft.track.length - segments.length + i),
      };
    },
  );

  const update = async (draftId: string, updates: { index: number; patch: SegmentPatch }[]): Promise<TrackDraft> =>
    editDraftTrack(api, draftId, (track) => {
      const seen = new Set<number>();
      for (const { index } of updates) {
        if (!Number.isInteger(index) || index < 0 || index >= track.length) {
          throw new Error(`update: index ${JSON.stringify(index)} is outside 0..${track.length - 1}`);
        }
        if (seen.has(index)) throw new Error(`update: index ${index} patched twice — one patch per Segment per call`);
        seen.add(index);
      }
      const next = [...track];
      for (const { index, patch } of updates) next[index] = applyPatch(next[index]!, patch);
      return next;
    });

  jsonTool(
    server,
    "update_segment",
    "Patch one Segment by index: placement fields replace, attachments set — or detach with explicit null (false works on the true-or-absent flags). Absent fields keep their values.",
    {
      draftId: DRAFT_ID,
      index: z.number().int().min(0).describe("Which Segment (get_draft's order)."),
      patch: SegmentPatchSchema.describe("The fields to change; absent keeps, null detaches."),
    },
    async ({ draftId, index, patch }) => withoutMeta(await update(draftId, [{ index, patch }])),
  );

  jsonTool(
    server,
    "update_segments",
    "Patch several Segments atomically — one patch per index per call, one invalid entry writes nothing.",
    {
      draftId: DRAFT_ID,
      updates: z
        .array(
          z
            .object({
              index: z.number().int().min(0).describe("Which Segment (get_draft's order)."),
              patch: SegmentPatchSchema.describe("The fields to change; absent keeps, null detaches."),
            })
            .strict(),
        )
        .min(1)
        .max(500),
    },
    async ({ draftId, updates }) => withoutMeta(await update(draftId, updates)),
  );

  const remove = async (draftId: string, indices: number[]): Promise<TrackDraft> =>
    editDraftTrack(api, draftId, (track) => {
      const ordered = assertIndexList(track.length, indices, "remove");
      const next = [...track];
      for (let i = ordered.length - 1; i >= 0; i -= 1) next.splice(ordered[i]!, 1);
      return next;
    });

  jsonTool(
    server,
    "remove_segment",
    "Delete one Segment by index. Later Segments slide down — re-read before the next indexed edit.",
    { draftId: DRAFT_ID, index: z.number().int().min(0).describe("Which Segment (get_draft's order).") },
    async ({ draftId, index }) => withoutMeta(await remove(draftId, [index])),
  );

  jsonTool(
    server,
    "remove_segments",
    "Delete several Segments atomically — one bad index writes nothing. Later Segments slide down.",
    {
      draftId: DRAFT_ID,
      indices: z.array(z.number().int().min(0)).min(1).max(500).describe("Get_draft's order; deduped, then deleted."),
    },
    async ({ draftId, indices }) => withoutMeta(await remove(draftId, indices)),
  );

  jsonTool(
    server,
    "set_draft_meta",
    "Patch a draft's publish metadata — what the published Revision carries. Absent fields keep their values.",
    {
      draftId: DRAFT_ID,
      name: z.string().nullable().optional().describe("Display name, or null to untitle it."),
      roundType: z.enum(asTuple(ROUND_TYPES)).optional().describe("Which Round this drafts for."),
      timeLimitMs: TimeLimitSchema.optional(),
      survivorTarget: SurvivorTargetSchema.optional(),
      environment: z.enum(ENVIRONMENT_IDS).optional(),
    },
    async ({ draftId, ...patch }) =>
      withoutMeta(await api.patch<TrackDraft>(`/drafts/${draftId}`, patch as Partial<TrackDraft>)),
  );

  jsonTool(
    server,
    "discard_draft",
    "Throw a draft away. 404s on a typo'd id rather than silently succeeding.",
    { draftId: DRAFT_ID },
    async ({ draftId }) => api.del<{ id: string }>(`/drafts/${draftId}`),
  );
};
