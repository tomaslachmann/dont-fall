import {
  NAV_AGENT_RADIUS,
  navPath,
  trackSpawn,
  type Module,
  type ResolvedTrack,
  type Track,
  type TrackNav,
  type Vec3,
} from "@dont-fall/shared";

/**
 * One leg of the route a Bot would run (M17 ticket 02, ADR 0129): spawn →
 * each Checkpoint's Respawn → the Finish Zone. `points` is `navPath`'s own
 * corner list — `[from]` alone when the query joins nothing at all.
 */
export interface BotLeg {
  from: Vec3;
  to: Vec3;
  points: Vec3[];
  /**
   * Whether the path actually reaches `to` — false marks a leg that stops
   * short: a gap the navmesh doesn't cover yet (a moving Segment, a jump
   * across a hole — ticket 05's links), or `to` itself sitting off the mesh.
   */
  complete: boolean;
}

/**
 * How close a path's last corner must land to its intended target, measured
 * on the ground plane (a corner sits at floor height; a Checkpoint's Respawn
 * sits a capsule's clearance above it, so comparing all three axes would flag
 * every ordinary leg short). Bigger than the mesh's own edge erosion
 * (`NAV_AGENT_RADIUS`), small beside any real gap — ticket 01 measured the
 * base race's first gap at several metres.
 */
const LEG_GAP_TOLERANCE_M = NAV_AGENT_RADIUS * 3;

const reachesTarget = (points: Vec3[], to: Vec3): boolean => {
  const end = points.at(-1);
  return end !== undefined && Math.hypot(end.x - to.x, end.z - to.z) <= LEG_GAP_TOLERANCE_M;
};

/**
 * The route's own waypoints, in run order: the Start's slot-0 spawn, then
 * every Checkpoint's Respawn in the order `resolveTrack` already places them
 * (retired blocks, then gates by number), then the first Finish Zone, if the
 * Track has one (a Survival arena has none, and the route simply ends at the
 * last Checkpoint, or at the spawn alone).
 */
export const botRouteTargets = (resolved: ResolvedTrack, track: Track, modules: Record<string, Module>): Vec3[] => {
  const targets = [trackSpawn(track, 0, modules)];
  for (const checkpoint of resolved.checkpoints) targets.push(checkpoint.respawn);
  const finish = resolved.finishZones[0];
  if (finish) targets.push(finish.gate ? finish.gate.center : finish.trigger.center);
  return targets;
};

/**
 * One `navPath` query per consecutive pair of `targets` — the whole route a
 * Bot would run, drawn as one line per leg (M17 ticket 02). `nav` is built
 * fresh by the caller from the same `packages/shared` code the server runs;
 * nothing here decides where a Bot can walk, only where it stops.
 */
export const buildBotLegs = (nav: TrackNav, targets: Vec3[]): BotLeg[] => {
  const legs: BotLeg[] = [];
  for (let i = 0; i < targets.length - 1; i += 1) {
    const from = targets[i]!;
    const to = targets[i + 1]!;
    const points = navPath(nav, from, to) ?? [from];
    legs.push({ from, to, points, complete: reachesTarget(points, to) });
  }
  return legs;
};
