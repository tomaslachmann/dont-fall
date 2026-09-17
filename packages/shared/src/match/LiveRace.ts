import { lengthVec3, subVec3, type Vec3 } from "../math/vec3.js";
import type { Checkpoint } from "../simulation/Checkpoint.js";
import type { FinishZone } from "../simulation/FinishZone.js";
import { CRITICAL_SURVIVORS_ABOVE_TARGET, CRITICAL_TIME_LEFT_MS, HUD_THREAT_RADIUS_M, TICK_MS } from "../tuning.js";
import { rankWithTies } from "./ranking.js";

/**
 * A Character's split at the last Checkpoint it reached (ADR 0088): its gap to
 * the first arrival there. Negative when it arrived first — its lead over the
 * next to arrive. A Character alone at its Checkpoint so far has no split.
 */
export interface CheckpointSplit {
  checkpointIndex: number;
  /** Whole milliseconds. */
  gapMs: number;
}

/**
 * The running Race Round as the HUD reads it (ADR 0088) — computed by the
 * server, replicated on the snapshot, `null` outside a running Race Round.
 */
export interface LiveRace {
  /** Placement in this Round if it ended now, 1-based, ties shared. Every Character in the Round has one. */
  places: Record<string, number>;
  /** Only Characters with a split to show have an entry. */
  splits: Record<string, CheckpointSplit>;
}

/** The slice of a Character live placement reads. */
export interface Racer {
  position: Vec3;
  checkpointIndex: number | null;
  finishTick: number | null;
  eliminated?: boolean;
}

/** Where a runner is headed, in run order: each Checkpoint's centre, then the Finish Zones. */
export interface RaceTargets {
  checkpoints: Vec3[];
  finishes: Vec3[];
}

export const raceTargets = (checkpoints: readonly Checkpoint[], finishZones: readonly FinishZone[]): RaceTargets => ({
  checkpoints: checkpoints.map((checkpoint) => (checkpoint.gate ? checkpoint.gate.center : checkpoint.trigger.center)),
  finishes: finishZones.map((zone) => (zone.gate ? zone.gate.center : zone.trigger.center)),
});

/** Straight-line distance to the next thing this runner has to reach — the next Checkpoint, else the nearest Finish Zone. */
const distanceToNext = (racer: Racer, targets: RaceTargets): number => {
  const next = (racer.checkpointIndex ?? -1) + 1;
  const ahead = next < targets.checkpoints.length ? [targets.checkpoints[next]!] : targets.finishes;
  if (ahead.length === 0) return 0;
  return Math.min(...ahead.map((target) => lengthVec3(subVec3(target, racer.position))));
};

/**
 * Every Character's placement in this Round if it ended now (ADR 0088):
 * finished first by `finishTick`, then everyone still running by the
 * Checkpoint reached and distance to the next target, then the Eliminated
 * the same way. Finishers on one Tick share a placement; runners only tie on
 * an identical position.
 */
export const liveRacePlaces = (characters: Record<string, Racer>, targets: RaceTargets): Record<string, number> => {
  const tier = (racer: Racer): number => (racer.finishTick !== null ? 0 : racer.eliminated ? 2 : 1);
  const rows = Object.entries(characters).map(([id, racer]) => ({
    id,
    tier: tier(racer),
    finishTick: racer.finishTick ?? 0,
    checkpoint: racer.checkpointIndex ?? -1,
    distance: racer.finishTick === null ? distanceToNext(racer, targets) : 0,
  }));
  type Row = (typeof rows)[number];
  const tied = (a: Row, b: Row): boolean =>
    a.tier === b.tier &&
    (a.tier === 0 ? a.finishTick === b.finishTick : a.checkpoint === b.checkpoint && a.distance === b.distance);
  rows.sort(
    (a, b) =>
      a.tier - b.tier ||
      (a.tier === 0 ? a.finishTick - b.finishTick : b.checkpoint - a.checkpoint || a.distance - b.distance) ||
      a.id.localeCompare(b.id),
  );
  const placements = rankWithTies(rows, tied);
  return Object.fromEntries(rows.map((row, i) => [row.id, placements[i]!]));
};

/**
 * The Tick each Character first reached each Checkpoint this Round, index-
 * aligned with the Track's Checkpoints — a hole for one skipped past.
 */
export type CheckpointArrivals = Record<string, (number | undefined)[]>;

/**
 * Records this Tick's arrivals (ADR 0088) — every Checkpoint up to the one
 * each Character now holds that has no arrival yet gets `tick`. The server
 * calls it every RUNNING Tick; a Checkpoint only ever counts forward, so an
 * arrival once written is never moved.
 */
export const recordCheckpointArrivals = (
  arrivals: CheckpointArrivals,
  characters: Record<string, Pick<Racer, "checkpointIndex">>,
  tick: number,
): void => {
  for (const [id, { checkpointIndex }] of Object.entries(characters)) {
    if (checkpointIndex === null) continue;
    const ticks = (arrivals[id] ??= []);
    if (ticks[checkpointIndex] !== undefined) continue;
    ticks[checkpointIndex] = tick;
  }
};

/**
 * Every split there is to show (ADR 0088): for each Character, its arrival at
 * its latest Checkpoint against the earliest other arrival there. Positive —
 * behind the first. Negative — first, ahead of the next. The same subtraction
 * answers both.
 */
export const checkpointSplits = (
  arrivals: CheckpointArrivals,
  characters: Record<string, Pick<Racer, "checkpointIndex">>,
): Record<string, CheckpointSplit> => {
  const splits: Record<string, CheckpointSplit> = {};
  for (const [id, { checkpointIndex }] of Object.entries(characters)) {
    if (checkpointIndex === null) continue;
    const mine = arrivals[id]?.[checkpointIndex];
    if (mine === undefined) continue;
    let earliestOther: number | undefined;
    for (const otherId of Object.keys(characters)) {
      if (otherId === id) continue;
      const theirs = arrivals[otherId]?.[checkpointIndex];
      if (theirs !== undefined && (earliestOther === undefined || theirs < earliestOther)) earliestOther = theirs;
    }
    if (earliestOther === undefined) continue;
    splits[id] = { checkpointIndex, gapMs: Math.round((mine - earliestOther) * TICK_MS) };
  }
  return splits;
};

/**
 * Who the Race HUD warns about (ADR 0088): the Character placed directly
 * behind you, still running, within {@link HUD_THREAT_RADIUS_M}. `null` once
 * you have finished or are out, or when nobody is that close.
 */
export const threatBehind = (myId: string, places: Record<string, number>, characters: Record<string, Racer>): string | null => {
  const me = characters[myId];
  const myPlace = places[myId];
  if (!me || myPlace === undefined || me.finishTick !== null || me.eliminated) return null;
  let closest: { id: string; place: number } | null = null;
  for (const [id, racer] of Object.entries(characters)) {
    const place = places[id];
    if (id === myId || place === undefined || place <= myPlace || racer.finishTick !== null || racer.eliminated) continue;
    if (closest === null || place < closest.place) closest = { id, place };
  }
  if (closest === null) return null;
  const distance = lengthVec3(subVec3(characters[closest.id]!.position, me.position));
  return distance <= HUD_THREAT_RADIUS_M ? closest.id : null;
};

/**
 * Whether the Survival HUD shows its danger warning (ADR 0088): survivors
 * within {@link CRITICAL_SURVIVORS_ABOVE_TARGET} of the Survivor Target, or
 * the clock under {@link CRITICAL_TIME_LEFT_MS}. A warning read off real
 * state — no zone and no mechanic behind it.
 */
export const survivalCritical = (survivors: number, survivorTarget: number, timeLeftMs: number): boolean =>
  survivors - survivorTarget <= CRITICAL_SURVIVORS_ABOVE_TARGET || timeLeftMs <= CRITICAL_TIME_LEFT_MS;
