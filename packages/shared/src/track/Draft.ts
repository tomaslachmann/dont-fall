import type { RoundType } from "../match/RoundType.js";
import type { EnvironmentId } from "./Environment.js";
import type { Track } from "./Track.js";

/**
 * A Track under construction (ADR 0114) — what the MCP server edits through
 * the API's draft endpoints. Unlike a Revision (immutable, course-complete),
 * a draft is mutable and allowed to be half-built: no start, no finish, no
 * problem until `validate`/`publish` say otherwise. Segments plus the same
 * publish metadata a Revision carries, so publishing a draft is a copy.
 */
export interface TrackDraft {
  id: string;
  name: string | null;
  roundType: RoundType;
  track: Track;
  timeLimitMs: number;
  survivorTarget: number;
  environment: EnvironmentId;
  createdAt: number;
  updatedAt: number;
}

/**
 * A draft row without Segments — what the listing carries, so resuming work
 * never downloads every unfinished Track.
 */
export interface TrackDraftListing {
  id: string;
  name: string | null;
  roundType: RoundType;
  segmentCount: number;
  updatedAt: number;
}
