import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  invalidTrackCourseReason,
  roundStartBlockedReason,
  trackHasFinishZone,
  type RoundType,
  type Track,
  type TrackDraft,
} from "@dont-fall/shared";
import { z } from "zod";
import type { TrackApi } from "../api.js";
import { jsonTool } from "../tools.js";
import { invalidEditReason, TRACK_REGISTRY } from "./segments.js";

/**
 * The publish gate, run before anything is published (ADR 0114, D5): the same
 * shape, attachment and course rules the API's publish enforces, plus the
 * round-type rule the API never sees (Tracks carry no Round-type tag, ADR
 * 0041 — a Race needs a Finish Zone, Survival needs nothing). `publish_draft`
 * refuses on the same verdict, so validate-then-publish never surprises.
 */

export interface DraftValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Judges `track` as a `roundType` Round: errors refuse a publish, warnings are
 * the things an author should look at (an ignored launch, an unused finish,
 * a gappy Checkpoint count). Pure over shared's own validators, so the gate
 * and the game can never disagree about what a course is.
 */
export const validateTrackForRound = (track: Track, roundType: RoundType): DraftValidation => {
  const errors: string[] = [];
  const warnings: string[] = [];

  const badEdit = invalidEditReason(track);
  if (badEdit) errors.push(badEdit);
  const badCourse = invalidTrackCourseReason(track, TRACK_REGISTRY);
  if (badCourse) errors.push(badCourse);
  const blocked = roundStartBlockedReason(roundType, trackHasFinishZone(track, TRACK_REGISTRY));
  if (blocked) errors.push(blocked);

  // A launch where no Spring stands is stored and ignored (resolve reads the
  // def, not the Segment) — almost always a misplaced Segment, never intent.
  for (const [index, segment] of track.entries()) {
    if (segment.launch !== undefined && TRACK_REGISTRY[segment.moduleId]?.launch === undefined) {
      warnings.push(`track[${index}] launches ${segment.launch.height} m but "${segment.moduleId}" is no Spring — ignored`);
    }
  }
  if (roundType === "survival" && trackHasFinishZone(track, TRACK_REGISTRY)) {
    warnings.push("a finish sign stands but Survival never reads it — harmless, only visual");
  }
  if (roundType === "race") {
    const orders = track.flatMap((segment) => (segment.checkpoint === undefined ? [] : [segment.checkpoint.order]));
    if (orders.length === 0) {
      warnings.push("no Checkpoints — a Race without splits still runs, every fall restarts at the Start");
    } else {
      const max = Math.max(...orders);
      const missing = Array.from({ length: max }, (_, i) => i + 1).filter((order) => !orders.includes(order));
      if (missing.length > 0) warnings.push(`Checkpoint order skips ${missing.join(", ")} — the count still runs 1..${max}`);
    }
  }
  return { valid: errors.length === 0, errors, warnings };
};

export const registerValidateTools = (server: McpServer, api: TrackApi): void => {
  jsonTool(
    server,
    "validate_draft",
    "Judge a draft by its Round type without publishing it: errors refuse a publish, warnings deserve a look. The fast half of try-check-fix; screenshot_draft is the visual backstop.",
    { draftId: z.string().min(1).describe("Draft id from create_draft (or list_drafts to resume).") },
    async ({ draftId }) => {
      const draft = await api.get<TrackDraft>(`/drafts/${draftId}`);
      return { draftId, roundType: draft.roundType, ...validateTrackForRound(draft.track, draft.roundType) };
    },
  );
};
