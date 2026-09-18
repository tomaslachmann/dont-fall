import type { EnvironmentId } from "./Environment.js";
import type { Track } from "./Track.js";
import {
  COG_ARENA_ENVIRONMENT,
  COG_ARENA_NAME,
  COG_ARENA_SURVIVOR_TARGET,
  COG_ARENA_TIME_LIMIT_MS,
  COG_ARENA_TRACK,
  COG_ARENA_TRACK_ID,
} from "./cogArena.js";
import {
  SKY_RINGS_ENVIRONMENT,
  SKY_RINGS_NAME,
  SKY_RINGS_SURVIVOR_TARGET,
  SKY_RINGS_TIME_LIMIT_MS,
  SKY_RINGS_TRACK,
  SKY_RINGS_TRACK_ID,
} from "./skyRings.js";
import {
  SLIP_STREAM_ENVIRONMENT,
  SLIP_STREAM_NAME,
  SLIP_STREAM_TIME_LIMIT_MS,
  SLIP_STREAM_TRACK,
  SLIP_STREAM_TRACK_ID,
} from "./slipStream.js";
import {
  SPIN_CYCLE_ENVIRONMENT,
  SPIN_CYCLE_NAME,
  SPIN_CYCLE_TIME_LIMIT_MS,
  SPIN_CYCLE_TRACK,
  SPIN_CYCLE_TRACK_ID,
} from "./spinCycle.js";

/**
 * One code-authored Track and everything a publish needs to store it — the
 * same fields `POST /tracks` takes.
 */
export interface AuthoredTrack {
  id: string;
  name: string;
  track: Track;
  timeLimitMs: number;
  /** Survival Tracks only: how many Players a Round leaves standing before it ends. */
  survivorTarget?: number;
  environment?: EnvironmentId;
  /**
   * Its Thumbnail (ADR 0105): a file in the assets directory, rendered by
   * `pnpm render:thumbnails` and sent by `pnpm publish:tracks`, as the base
   * race carries `base_race.jpg`.
   */
  thumbnailFile: string;
}

/**
 * The Tracks written as code in this folder and published to a running API by
 * `pnpm publish:tracks` — two Races and two Survival arenas.
 *
 * They are deliberately *not* boot seeds. ADR 0078 leaves exactly one of
 * those, the base race, which the API syncs (and re-syncs over any edit) every
 * time it starts. These go up the ordinary way a builder Track does: a publish
 * stores a new immutable Revision (ADR 0032), so re-running the script after
 * editing a file is how a change reaches a Match, and editing one of these in
 * the Track builder is a real edit that nothing undoes.
 */
export const AUTHORED_TRACKS: readonly AuthoredTrack[] = [
  {
    id: SPIN_CYCLE_TRACK_ID,
    name: SPIN_CYCLE_NAME,
    track: SPIN_CYCLE_TRACK,
    timeLimitMs: SPIN_CYCLE_TIME_LIMIT_MS,
    environment: SPIN_CYCLE_ENVIRONMENT,
    thumbnailFile: "spin_cycle.jpg",
  },
  {
    id: SLIP_STREAM_TRACK_ID,
    name: SLIP_STREAM_NAME,
    track: SLIP_STREAM_TRACK,
    timeLimitMs: SLIP_STREAM_TIME_LIMIT_MS,
    environment: SLIP_STREAM_ENVIRONMENT,
    thumbnailFile: "slip_stream.jpg",
  },
  {
    id: COG_ARENA_TRACK_ID,
    name: COG_ARENA_NAME,
    track: COG_ARENA_TRACK,
    timeLimitMs: COG_ARENA_TIME_LIMIT_MS,
    survivorTarget: COG_ARENA_SURVIVOR_TARGET,
    environment: COG_ARENA_ENVIRONMENT,
    thumbnailFile: "cog_arena.jpg",
  },
  {
    id: SKY_RINGS_TRACK_ID,
    name: SKY_RINGS_NAME,
    track: SKY_RINGS_TRACK,
    timeLimitMs: SKY_RINGS_TIME_LIMIT_MS,
    survivorTarget: SKY_RINGS_SURVIVOR_TARGET,
    environment: SKY_RINGS_ENVIRONMENT,
    thumbnailFile: "sky_rings.jpg",
  },
];
