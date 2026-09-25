import { vec3, type Vec3 } from "../math/vec3.js";
import { MOVING_SEGMENT_STAGGER_SPEED } from "../simulation/MovingSegment.js";
import type { CharacterSnapshot } from "../state/SimState.js";
import { surfaceConfig } from "../track/Surface.js";
import {
  BOT_BRAKE_MIN_SPEED,
  BOT_EDGE_GUARD_SLACK_M,
  BOT_PLAN_CONTACT_COST,
  BOT_PLAN_DEVIATION_COST,
  BOT_PLAN_EDGE_COST,
  BOT_PLAN_HELD_MIN_TURN_DEG,
  BOT_PLAN_HORIZON_TICKS,
  BOT_PLAN_KEEP_BONUS,
  BOT_PLAN_LOOK_M,
  BOT_PLAN_PROGRESS_WEIGHT,
  BOT_PLAN_STAGGER_COST,
  BOT_PLAN_TURN_DEGREES,
} from "../tuning/bots.js";
import { CAPSULE_BOTTOM_OFFSET, WALK_SPEED } from "../tuning/character.js";
import { TICK_DT } from "../tuning/clock.js";
import { accelerate, crossesOut, voidEdgesNear, type Motion, type VoidEdge } from "./edgeGuard.js";
import { corridorAhead, type HookContext } from "./hooks.js";
import { inHull, type MovingBody, type Platform } from "./movingWorld.js";
import { navSurfaceAt } from "./navMesh.js";
import type { Steering } from "./PathBot.js";

/*
 * The local motion planner (M17 ticket 14, ADR 0130): between the path and
 * the input, what a Bot does over the next second where the way forward is
 * refused. Before it, `SweeperHold` chose for itself — a `retreat` back
 * along the path, which walked into the arm it ran from at up to 5.5 u/s and
 * lifted the closing speed over the Stagger threshold (07m: 229 of 252
 * spin-bar impacts at HARD came during a retreat, and the bar alone reached
 * the threshold 6 times in 697), or a `stand` that only braked on ice.
 *
 * Here every candidate move — a stand, the asked move, its turns, sideways
 * and back — is *played* for a short horizon through `accelerate`, the model
 * of the Character the guard already uses, against the moving bodies near at
 * their exact poses, and scored: progress toward the path's look-ahead point,
 * less a Stagger (a body occupying the capsule at a closing speed the
 * simulation Staggers from, counting the candidate's own velocity, as the
 * simulation counts it), less each Tick of being pushed, less an edge (a
 * push carries the rollout along with the body, so a shove toward a drop is
 * paid for as a Fall), less the turn from the path. The best is sent; the
 * guard still vets it (ADR 0129: never steps off), and the hold keeps its cap
 * (never stranded). A stand brakes to zero on every floor, not only a slick
 * one (07m: at EASY 113 impacts came "standing" with the Bot still moving).
 *
 * Only moving bodies are modelled here (ticket 14, phase 1); the crowd is
 * phase 3, and the go/hold decision itself stays the hold's (ADR 0130, point
 * 3). Deterministic: no draw is made, and the same ask scores the same.
 */

/** One move the planner may choose: a unit direction across the ground, or a stand (`null`). */
export interface Candidate {
  /** `stand`, or the turn from the asked move in degrees (`0`, `15`, `-15`, …). */
  readonly name: string;
  readonly direction: Vec3 | null;
}

/** What the planner is asked. */
export interface PlanAsk {
  readonly ctx: HookContext;
  /** The move the path asks for: a unit vector across the ground. */
  readonly asked: Vec3;
  /** The moving bodies near, as the hold found them (never one that never moves). */
  readonly near: readonly MovingBody[];
  /** Metres a body's hitbox is grown by, beyond the capsule's own radius, before it counts as touching. */
  readonly grow: number;
  /** The moving deck the Bot stands on, or null: its edges are then the deck's, and a point it reaches is carried with it. */
  readonly deck: Platform | null;
  /** Whether the hold refused the way forward: then only turns of {@link BOT_PLAN_HELD_MIN_TURN_DEG} or more, and the stand, are tried. */
  readonly forwardRefused: boolean;
}

/** One candidate's score and how it was made up, for a suite or a log to read. */
export interface Scored {
  readonly candidate: Candidate;
  readonly score: number;
  readonly progress: number;
  readonly staggered: boolean;
  readonly contact: number;
  /** Pushed off the floor by a body: a Fall. */
  readonly edge: boolean;
  /** Stopped at an edge's margin by the guard, and stood there for the rest of the horizon. */
  readonly stopped: boolean;
}

export interface Choice {
  readonly candidate: Candidate;
  /** Every candidate tried, in the order tried. */
  readonly scored: readonly Scored[];
}

const STAND: Steering = { moveDirection: vec3(), dash: false };
const STAND_CANDIDATE: Candidate = { name: "stand", direction: null };

const groundDistance = (a: Vec3, b: Vec3): number => Math.hypot(b.x - a.x, b.z - a.z);

/** Where the Bot's progress is measured toward: {@link BOT_PLAN_LOOK_M} along its path, or the path's last corner when it is shorter; null with no path. */
const lookAheadPoint = (ctx: HookContext): Vec3 | null => {
  const samples = corridorAhead(ctx, BOT_PLAN_LOOK_M, BOT_PLAN_LOOK_M);
  if (samples.length >= 2) return samples[samples.length - 1]!.p;
  const last = ctx.path[ctx.path.length - 1];
  return last === undefined || ctx.corner >= ctx.path.length ? null : last.point;
};

export class LocalMotionPlanner {
  /** The candidate chosen last, for {@link BOT_PLAN_KEEP_BONUS}. */
  private lastName: string | null = null;

  constructor(readonly seed: string) {}

  /** The hold this planner serves has ended: the next choice starts afresh. */
  forget(): void {
    this.lastName = null;
  }

  /** The best candidate for `ask`, with every candidate's score. */
  choose(ask: PlanAsk): Choice {
    const { ctx, asked, near, deck, forwardRefused } = ask;
    const { view, self, tick, clock, stale } = ctx;
    const { moving, nav } = view.track;
    const surface = surfaceConfig(navSurfaceAt(nav, self.position) ?? undefined);
    const wish = WALK_SPEED * surface.topSpeedMultiplier;
    const { grip } = surface;
    const speed = Math.hypot(self.velocity.x, self.velocity.z);
    // A stand must be safe for as long as the Bot cannot see itself standing.
    const horizon = BOT_PLAN_HORIZON_TICKS + stale.max;
    const feetY = self.position.y - CAPSULE_BOTTOM_OFFSET;
    // The furthest a rollout gets: its own walk, or a body's push at its speed.
    let pushSpeed = 0;
    for (const body of near) {
      const v = moving.velocityAt(body.index, tick, clock, self.position);
      pushSpeed = Math.max(pushSpeed, Math.hypot(v.x, v.z));
    }
    const reach = horizon * Math.max(wish, speed, pushSpeed) * TICK_DT + BOT_EDGE_GUARD_SLACK_M;
    const edges: readonly VoidEdge[] = deck === null ? voidEdgesNear(nav, self.position, feetY, reach) : [];
    const goal = lookAheadPoint(ctx);
    const d0 = goal === null ? 0 : groundDistance(self.position, goal);
    const askedLength = Math.hypot(asked.x, asked.z);
    const ux = askedLength > 0 ? asked.x / askedLength : 0;
    const uz = askedLength > 0 ? asked.z / askedLength : 0;
    // The rollout runs in the world as it is at `tick`; a point the Bot reaches at `at` on a moving deck is carried with it by then (07g).
    const carried = (x: number, z: number, at: number): Vec3 => {
      const p = { x, y: self.position.y, z };
      return deck === null ? p : moving.toWorld(deck, at, clock, moving.toLocal(deck, tick, clock, p));
    };

    const scored: Scored[] = [];
    let best: Scored | null = null;
    const consider = (candidate: Candidate): void => {
      const result = this.rollout(candidate, ask, { wish, grip, horizon, edges, goal, d0, carried });
      scored.push(result);
      if (best === null || result.score > best.score) best = result;
    };
    consider(STAND_CANDIDATE);
    if (askedLength > 0) {
      for (const degrees of BOT_PLAN_TURN_DEGREES) {
        if (forwardRefused && Math.abs(degrees) < BOT_PLAN_HELD_MIN_TURN_DEG) continue;
        const angle = (degrees * Math.PI) / 180;
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        consider({ name: `${degrees}`, direction: vec3(ux * c - uz * s, 0, ux * s + uz * c) });
      }
    }
    const chosen = best!;
    this.lastName = chosen.candidate.name;
    return { candidate: chosen.candidate, scored };
  }

  /** The move to send this Tick for `choice`: a stand that brakes, else the candidate's own direction. */
  steer(ctx: HookContext, choice: Choice): Steering {
    const { direction } = choice.candidate;
    if (direction === null) return this.stand(ctx);
    return { moveDirection: direction, dash: false };
  }

  /** A stand where the Bot sees itself: {@link brake} on the floor under it. */
  stand(ctx: HookContext): Steering {
    return this.brake(ctx.self, surfaceConfig(navSurfaceAt(ctx.view.track.nav, ctx.self.position) ?? undefined).grip);
  }

  /**
   * A stand that brakes to zero (ticket 14, phase 2): on a floor with grip a
   * zero move, since the movement model stops the body in the Tick without
   * one (ADR 0035's friction saturates), and on a slick floor a push against
   * the Bot's velocity until it is under {@link BOT_BRAKE_MIN_SPEED}. Never a
   * push on a floor with grip: the velocity a Bot sees is as stale as its
   * view, so a push against it there is a walk backwards at full speed once
   * the body has already stopped — the retreat by another name (measured,
   * ticket 14: every Bot hit "standing" at HARD was walking back at 5.5 u/s).
   */
  brake(self: Readonly<CharacterSnapshot>, grip: number): Steering {
    if (grip >= 1) return STAND;
    const speed = Math.hypot(self.velocity.x, self.velocity.z);
    if (speed < BOT_BRAKE_MIN_SPEED) return STAND;
    return { moveDirection: vec3(-self.velocity.x / speed, 0, -self.velocity.z / speed), dash: false };
  }

  /** `candidate` played for the horizon and scored (see the file's comment). */
  private rollout(
    candidate: Candidate,
    ask: PlanAsk,
    world: { wish: number; grip: number; horizon: number; edges: readonly VoidEdge[]; goal: Vec3 | null; d0: number; carried: (x: number, z: number, at: number) => Vec3 },
  ): Scored {
    const { ctx, near, grow, deck } = ask;
    const { view, self, tick, clock } = ctx;
    const { moving } = view.track;
    const { wish, grip, horizon, edges, goal, d0, carried } = world;
    const m: Motion = { x: self.position.x, z: self.position.z, vx: self.velocity.x, vz: self.velocity.z };
    let staggered = false;
    let edge = false;
    let contact = 0;
    /** Whether the guard has stopped this walk at an edge's margin: from then on the candidate stands. */
    let stopped = false;
    /** Whether `(x, z)` is off the floor: over an edge's inner line from `(x0, z0)`, or outside the deck the Bot rides. */
    const off = (x0: number, z0: number, x: number, z: number): boolean =>
      deck !== null ? !inHull(deck.deck.hull, moving.toLocal(deck, tick, clock, { x, y: self.position.y, z })) : edges.length > 0 && crossesOut(edges, x0, z0, x, z);
    for (let k = 1; k <= horizon && !staggered && !edge; k += 1) {
      // The step for Tick `at` is resolved against the bodies' poses at `at` (`RapierSimulation.tick`): the input
      // decided at `tick` meets the pose at `tick`, one step of the walk later.
      const at = tick + k - 1;
      const x0 = m.x;
      const z0 = m.z;
      if (candidate.direction === null || stopped) {
        // The brake, as {@link brake} sends it: a push against the velocity only on a slick floor.
        const s = Math.hypot(m.vx, m.vz);
        if (grip < 1 && s >= BOT_BRAKE_MIN_SPEED) accelerate(m, (-m.vx / s) * wish, (-m.vz / s) * wish, grip);
        else accelerate(m, 0, 0, grip);
      } else {
        accelerate(m, candidate.direction.x * wish, candidate.direction.z * wish, grip);
      }
      m.x += m.vx * TICK_DT;
      m.z += m.vz * TICK_DT;
      // A walk over the margin is one the guard never sends (ADR 0129): it stops the Bot there, and it stands.
      if (!stopped && off(x0, z0, m.x, m.z)) {
        stopped = true;
        m.x = x0;
        m.z = z0;
        m.vx = 0;
        m.vz = 0;
      }
      const q = carried(m.x, m.z, at);
      for (const body of near) {
        if (!moving.solidAt(body.index, at, view.fragile)) continue;
        // Most bodies are nowhere near the point: one distance against the body's own reach says so.
        const pose = moving.poseAt(body.index, at, clock);
        if (Math.hypot(pose.position.x - q.x, pose.position.z - q.z) > body.radius + grow + CAPSULE_BOTTOM_OFFSET) continue;
        if (!moving.occupies(body.index, at, clock, q, grow)) continue;
        const v = moving.velocityAt(body.index, at, clock, q);
        // The relative speed bounds the closing speed whatever face is met: the simulation's own rule
        // (`resolveMovingSegmentContacts`), with the candidate's velocity for the Character's.
        if (body.spiked || Math.hypot(v.x - m.vx, v.y, v.z - m.vz) >= MOVING_SEGMENT_STAGGER_SPEED) {
          staggered = true;
          break;
        }
        // Pushed: carried along with the body for the Tick, which no guard stops — over an edge, that is a Fall.
        contact += 1;
        const px = m.x;
        const pz = m.z;
        m.x += v.x * TICK_DT;
        m.z += v.z * TICK_DT;
        if (off(px, pz, m.x, m.z)) edge = true;
      }
    }
    const progress = goal === null ? 0 : d0 - groundDistance({ x: m.x, y: 0, z: m.z }, goal);
    const deviation = candidate.direction === null ? 0 : 1 - (candidate.direction.x * ask.asked.x + candidate.direction.z * ask.asked.z);
    const score =
      BOT_PLAN_PROGRESS_WEIGHT * progress -
      (staggered ? BOT_PLAN_STAGGER_COST : 0) -
      BOT_PLAN_CONTACT_COST * contact -
      (edge ? BOT_PLAN_EDGE_COST : 0) -
      BOT_PLAN_DEVIATION_COST * deviation +
      (candidate.name === this.lastName ? BOT_PLAN_KEEP_BONUS : 0);
    return { candidate, score, progress, staggered, contact, edge, stopped };
  }
}
