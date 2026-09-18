import type { Vec3 } from "../math/vec3.js";
import { DEFAULT_CHARACTER_ID, RapierSimulation } from "../simulation/RapierSimulation.js";
import { IDLE_INPUTS } from "../simulation/SimInputs.js";
import { TICK_RATE_HZ } from "../tuning/clock.js";
import type { Module } from "./Module.js";
import { resolveTrack } from "./resolveTrack.js";
import { trackSpawn, type Track } from "./Track.js";

/**
 * The scripted playtest the code-authored Tracks are proven with, shared by
 * their suites rather than copied into each (`baseRace.test.ts` wrote the
 * first one inline; four more would have been four more copies).
 *
 * The argument is the base race's, unchanged: with every Motion stopped at
 * rest the course is still a course — rest poses are laid out to leave a way
 * through — so a waypoint walker proves the geometry. Every gap is jumpable,
 * every ramp and Spring reaches the tier above, every Checkpoint is passed
 * and the finish is reached, without a Fall. What it cannot judge is whether
 * the obstacles' *timing* is fair; that is a play check, always.
 *
 * Not exported from the package index: it builds a Rapier world and belongs
 * to the suites, not to anything that ships.
 */
export interface Waypoint {
  /** Across the course. */
  x: number;
  /** Along the course, forward from its origin (world z = −s). */
  s: number;
  /** Press jump once the ground is back under the feet, on the way to the next one. */
  jump?: boolean;
  /** How close counts as arrived. */
  radius?: number;
}

export interface WalkOutcome {
  /** How many waypoints were reached. */
  reached: number;
  /** The first waypoint that could not be reached, if the walk stalled. */
  stuckAt?: Waypoint;
  /** Where the walk ended. */
  position: Vec3;
  seconds: number;
  fallCount: number;
  checkpointIndex: number | null;
  finished: boolean;
  /** The waypoint being walked to when the first Fall happened. */
  fellHeadingTo?: Waypoint;
}

export interface WalkOptions {
  /** Give up after this much simulated time. */
  maxSeconds?: number;
  /** Give up on a waypoint after this long without reaching it. */
  stuckSeconds?: number;
  /** Which spawn slot to start from. */
  spawnSlot?: number;
}

/** A Track with every Motion stopped — what {@link walkTrack} actually walks. */
export const atRest = (track: Track): Track => track.map(({ motion: _motion, ...segment }) => segment);

/**
 * Walks `waypoints` in order through `track` at rest and reports how far it
 * got. Steering is a straight line at the next waypoint, which is all the
 * proof a geometry check needs — a route that only works by hugging a wall
 * is a route a Player will not find either.
 */
export const walkTrack = (
  library: Record<string, Module>,
  track: Track,
  waypoints: readonly Waypoint[],
  { maxSeconds = 300, stuckSeconds = 20, spawnSlot = 0 }: WalkOptions = {},
): WalkOutcome => {
  const still = atRest(track);
  const sim = new RapierSimulation({ ...resolveTrack(library, still), withDefaultCharacter: false, authoritative: false });
  sim.addCharacter(DEFAULT_CHARACTER_ID, trackSpawn(still, spawnSlot, library));
  let next = 0;
  let pendingJump = false;
  let jumpTicks = 0;
  let sinceProgress = 0;
  let ticks = 0;
  let stuckAt: Waypoint | undefined;
  let fellHeadingTo: Waypoint | undefined;
  try {
    for (; ticks < maxSeconds * TICK_RATE_HZ; ticks += 1) {
      const character = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
      if (character.finishTick !== null) break;
      if (character.fallCount > 0 && fellHeadingTo === undefined) fellHeadingTo = waypoints[Math.min(next, waypoints.length - 1)];
      if (next >= waypoints.length) break;
      const waypoint = waypoints[next]!;
      const dx = waypoint.x - character.position.x;
      const dz = -waypoint.s - character.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance < (waypoint.radius ?? 1)) {
        // A jump waits for the ground: pressed mid-air it would be lost.
        if (waypoint.jump) pendingJump = true;
        next += 1;
        sinceProgress = 0;
        continue;
      }
      sinceProgress += 1;
      if (sinceProgress > stuckSeconds * TICK_RATE_HZ) {
        stuckAt = waypoint;
        break;
      }
      if (pendingJump && character.grounded) {
        jumpTicks = 8;
        pendingJump = false;
      }
      sim.tick({
        [DEFAULT_CHARACTER_ID]: {
          ...IDLE_INPUTS,
          moveDirection: { x: dx / (distance || 1), y: 0, z: dz / (distance || 1) },
          jumpHeld: jumpTicks > 0,
        },
      });
      if (jumpTicks > 0) jumpTicks -= 1;
    }
    const character = sim.snapshot().characters[DEFAULT_CHARACTER_ID]!;
    return {
      reached: next,
      ...(stuckAt === undefined ? {} : { stuckAt }),
      ...(fellHeadingTo === undefined ? {} : { fellHeadingTo }),
      position: character.position,
      seconds: ticks / TICK_RATE_HZ,
      fallCount: character.fallCount,
      checkpointIndex: character.checkpointIndex,
      finished: character.finishTick !== null,
    };
  } finally {
    sim.dispose();
  }
};

/** A route builder: `to` walks somewhere, `jumpFrom` takes off from an edge. */
export const route = (): {
  to: (x: number, s: number, radius?: number) => void;
  jumpFrom: (x: number, edge: number) => void;
  waypoints: Waypoint[];
} => {
  const waypoints: Waypoint[] = [];
  return {
    waypoints,
    to: (x, s, radius = 1) => void waypoints.push({ x, s, radius }),
    // Line up short of the edge, then take off from it — a jump pressed while
    // still walking toward the line lands in the gap.
    jumpFrom: (x, edge) => {
      waypoints.push({ x, s: edge - 1.5, radius: 0.5 });
      waypoints.push({ x, s: edge - 0.8, jump: true, radius: 0.5 });
    },
  };
};

export interface StandOutcome {
  /** How many of the Characters are still on their feet at the end. */
  grounded: number;
  /** How many Falls happened across all of them. */
  falls: number;
  /** Where each Character ended up, by spawn slot. */
  positions: Vec3[];
}

/**
 * Spawns `count` Characters on `track`'s Start grid and leaves them there with
 * no input for `seconds`, Motions running. What it proves for a Survival Track
 * is the one thing a Player cannot be asked to discover in a live Round: that
 * the spawn grid stands on floor, and that nothing sweeping the arena reaches
 * it during the Countdown — when input is locked and nobody can step aside.
 */
export const standOn = (
  library: Record<string, Module>,
  track: Track,
  count: number,
  seconds: number,
): StandOutcome => {
  const sim = new RapierSimulation({ ...resolveTrack(library, track), withDefaultCharacter: false, authoritative: false });
  const ids = Array.from({ length: count }, (_, i) => `p${i}`);
  for (const [i, id] of ids.entries()) sim.addCharacter(id, trackSpawn(track, i, library));
  try {
    const inputs = Object.fromEntries(ids.map((id) => [id, IDLE_INPUTS]));
    for (let tick = 0; tick < seconds * TICK_RATE_HZ; tick += 1) sim.tick(inputs);
    const characters = sim.snapshot().characters;
    return {
      grounded: ids.filter((id) => characters[id]!.grounded).length,
      falls: ids.reduce((sum, id) => sum + characters[id]!.fallCount, 0),
      positions: ids.map((id) => characters[id]!.position),
    };
  } finally {
    sim.dispose();
  }
};
