import { vec3, type Vec3 } from "../math/vec3.js";
import { isPlayerDrivenMotionState } from "../simulation/CharacterStateMachine.js";
import { MOVING_SEGMENT_STAGGER_SPEED } from "../simulation/MovingSegment.js";
import type { CharacterSnapshot } from "../state/SimState.js";
import { surfaceConfig } from "../track/Surface.js";
import {
  BOT_BRAKE_MIN_SPEED,
  BOT_EDGE_GUARD_SLACK_M,
  BOT_EDGE_MARGIN_M,
  BOT_LINK_QUEUE_HEIGHT_M,
  BOT_PLAN_CONTACT_COST,
  BOT_PLAN_CROWD_CONTACT_COST,
  BOT_PLAN_CROWD_EDGE_COST,
  BOT_PLAN_CROWD_EDGE_M,
  BOT_PLAN_CROWD_REACH_M,
  BOT_PLAN_CROWD_TOUCH_M,
  BOT_PLAN_DEVIATION_COST,
  BOT_PLAN_EDGE_COST,
  BOT_PLAN_HELD_MIN_TURN_DEG,
  BOT_PLAN_HORIZON_TICKS,
  BOT_PLAN_KEEP_BONUS,
  BOT_PLAN_LOOK_M,
  BOT_PLAN_PROGRESS_WEIGHT,
  BOT_PLAN_SIDE_BIAS,
  BOT_PLAN_STAGGER_COST,
  BOT_PLAN_TURN_DEGREES,
  BOT_RIDE_RIM_INSET_M,
} from "../tuning/bots.js";
import { CAPSULE_BOTTOM_OFFSET, CAPSULE_RADIUS, WALK_SPEED } from "../tuning/character.js";
import { TICK_DT } from "../tuning/clock.js";
import { accelerate, crossesOut, voidEdgeDistance, voidEdgesNear, type Motion, type VoidEdge } from "./edgeGuard.js";
import { corridorAhead, type HookContext } from "./hooks.js";
import type { MovingBody, Platform } from "./movingWorld.js";
import { navSurfaceAt } from "./navMesh.js";
import type { Steering } from "./PathBot.js";
import { botDraw } from "./random.js";
import { hullDistance } from "./rideLinks.js";

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
 * The crowd (ticket 14, phase 3): the Characters near, as the Bot sees them,
 * are extrapolated at their own velocity over the rollout. Contact on its
 * own is not a Fall: what is scored is a Bump that would Stagger (a closing
 * speed at a predicted overlap of `MOVING_SEGMENT_STAGGER_SPEED` or more —
 * the simulation's own rule through `BUMP_IMPULSE_SCALE`; two Bots walking at
 * each other close at 11 u/s), and a shove: an overlap displaces the rollout
 * away from the other, as two capsules resolve, so a contact beside a drop is
 * paid for as a Fall, and every contact costs a little more the nearer the
 * edge. Twelve planners alike would all dodge the same way and oscillate, so
 * each Bot has a preferred side drawn from its seed, a small bias in the
 * score, and the keep bonus holds its choice. A ride's positioning (a
 * waiting spot, a walk across a deck, a stand aboard) is asked in the
 * deck's frame, where the floor's edge is the deck's outline less a margin
 * for how late the Bot sees itself. The go/hold decision itself stays the
 * hold's (ADR 0130, point 3). Deterministic: the one draw is the side, once.
 */

/** One move the planner may choose: a unit direction across the ground, or a stand (`null`). */
export interface Candidate {
  /** `stand`, or the turn from the asked move in degrees (`0`, `15`, `-15`, …). */
  readonly name: string;
  readonly direction: Vec3 | null;
  /** The turn from the asked move in degrees; 0 for the stand and the asked move. */
  readonly turn: number;
}

/** Another Character as the crowd sees it (ticket 14, phase 3): where it is and how it moves, as the Bot sees it, on the Bot's floor. */
export interface Neighbour {
  readonly x: number;
  readonly z: number;
  /** Its own velocity, units/s (a deck's carry is not in it). */
  readonly vx: number;
  readonly vz: number;
  /** Standing on the deck the Bot rides: then it is carried with it, and its point moves by its own velocity in the deck's frame. */
  readonly aboard: boolean;
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
  /** The Characters near (ticket 14, phase 3), as the Bot sees them; none: no crowd is scored. */
  readonly others?: readonly Neighbour[];
  /**
   * A hold of the spot (phase 3): the Bot means to stand here (a wait aboard, a waiting spot), so progress is measured as
   * staying put and no turn is a deviation; `asked` is then only the reference the turns are taken from.
   */
  readonly holdHere?: boolean;
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
  /** The step the stop came at, 1-based; `Infinity` when it never did. */
  readonly stoppedAt: number;
  /** Bumped by another Character at a closing speed that Staggers (ticket 14, phase 3). */
  readonly bumped: boolean;
  /** Ticks of overlap with another Character, each weighted by how near a drop it is. */
  readonly crowd: number;
}

export interface Choice {
  readonly candidate: Candidate;
  /** Every candidate tried, in the order tried. */
  readonly scored: readonly Scored[];
}

const STAND: Steering = { moveDirection: vec3(), dash: false };
const STAND_CANDIDATE: Candidate = { name: "stand", direction: null, turn: 0 };

/**
 * The Characters within {@link BOT_PLAN_CROWD_REACH_M} of the Bot on its own
 * floor, as it sees them (ticket 14, phase 3), each with whether it rides
 * `deck`; `except` (the Character the Fight is after, item 6) and anyone not
 * driving their own Character are left out.
 */
export const neighboursOf = (ctx: HookContext, deck: Platform | null, except: string | null = null): Neighbour[] => {
  const { view, self, tick, clock } = ctx;
  const { moving } = view.track;
  const out: Neighbour[] = [];
  for (const [id, other] of Object.entries(view.characters)) {
    if (id === view.id || id === except || other.eliminated || !isPlayerDrivenMotionState(other.motionState)) continue;
    if (Math.abs(other.position.y - self.position.y) >= BOT_LINK_QUEUE_HEIGHT_M) continue;
    if (groundDistance(other.position, self.position) > BOT_PLAN_CROWD_REACH_M) continue;
    out.push({
      x: other.position.x,
      z: other.position.z,
      vx: other.velocity.x,
      vz: other.velocity.z,
      aboard: deck !== null && moving.platformUnder(other.position, tick, clock) === deck,
    });
  }
  return out;
};
/** How near two capsule centres count as touching in the rollout: two radii and a little. */
const TOUCH = 2 * CAPSULE_RADIUS + BOT_PLAN_CROWD_TOUCH_M;

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
  /** This Bot's preferred side in a crowd (ticket 14, phase 3): the sign of the turns it favours, drawn once from its seed. */
  private readonly side: number;

  constructor(readonly seed: string) {
    this.side = botDraw(seed, "crowd side") < 0.5 ? 1 : -1;
  }

  /** The hold this planner serves has ended: the next choice starts afresh. */
  forget(): void {
    this.lastName = null;
  }

  /** The best candidate for `ask`, with every candidate's score. */
  choose(ask: PlanAsk): Choice {
    const { ctx, asked, near, deck, forwardRefused, others = [] } = ask;
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
    // On a deck the floor's edge is the outline less the guard's margin and what the Bot walks while its view lags (07h: a
    // rider steered live off a late view walked past the rim before its own rim check saw it; traced in phase 3, item 0).
    // (Attempt 2 took the whole lag as the margin, 2.2 m at NORMAL, which covered every row and square: every walk aboard
    // stopped on its first step.) The lag is answered instead by `stoppedAt`: a stop within it is sent as a stand.
    const deckMargin = BOT_EDGE_MARGIN_M + BOT_RIDE_RIM_INSET_M;
    const goal = ask.holdHere === true ? self.position : lookAheadPoint(ctx);
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
      const result = this.rollout(candidate, ask, { wish, grip, horizon, edges, goal, d0, carried, deckMargin, others });
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
        consider({ name: `${degrees}`, direction: vec3(ux * c - uz * s, 0, ux * s + uz * c), turn: degrees });
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
    world: {
      wish: number;
      grip: number;
      horizon: number;
      edges: readonly VoidEdge[];
      goal: Vec3 | null;
      d0: number;
      carried: (x: number, z: number, at: number) => Vec3;
      deckMargin: number;
      others: readonly Neighbour[];
    },
  ): Scored {
    const { ctx, near, grow, deck } = ask;
    const { view, self, tick, clock } = ctx;
    const { moving } = view.track;
    const { wish, grip, horizon, edges, goal, d0, carried, deckMargin, others } = world;
    const m: Motion = { x: self.position.x, z: self.position.z, vx: self.velocity.x, vz: self.velocity.z };
    let staggered = false;
    let edge = false;
    let contact = 0;
    let bumped = false;
    let crowd = 0;
    /** Whether the guard has stopped this walk at an edge's margin: from then on the candidate stands. */
    let stopped = false;
    let stoppedAt = Infinity;
    /** Whether `(x, z)` is off the floor: over an edge's inner line from `(x0, z0)`, or outside the deck the Bot rides, less its margin. */
    const off = (x0: number, z0: number, x: number, z: number): boolean =>
      deck !== null ? hullDistance(deck.deck.hull, moving.toLocal(deck, tick, clock, { x, y: self.position.y, z })) > -deckMargin : edges.length > 0 && crossesOut(edges, x0, z0, x, z);
    /** How near a drop `(x, z)` is, 1 at the edge to 0 at {@link BOT_PLAN_CROWD_EDGE_M}: on a deck its outline, else the void edges near. */
    const edgeCloseness = (x: number, z: number): number => {
      const d = deck !== null ? -hullDistance(deck.deck.hull, moving.toLocal(deck, tick, clock, { x, y: self.position.y, z })) : voidEdgeDistance(edges, x, z);
      return Math.max(0, 1 - d / BOT_PLAN_CROWD_EDGE_M);
    };
    for (let k = 1; k <= horizon && !staggered && !edge && !bumped; k += 1) {
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
        stoppedAt = k;
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
      if (staggered || edge) break;
      // The crowd (phase 3): each Character near, where it will be by now at its own velocity. Its point is in the Bot's own
      // frame when it rides the same deck, else in the world the rollout's point is carried into.
      for (const o of others) {
        const ox = o.x + o.vx * k * TICK_DT;
        const oz = o.z + o.vz * k * TICK_DT;
        const px = o.aboard ? m.x : q.x;
        const pz = o.aboard ? m.z : q.z;
        const d = Math.hypot(ox - px, oz - pz);
        if (d >= TOUCH) continue;
        const ux = d > 0 ? (px - ox) / d : 1;
        const uz = d > 0 ? (pz - oz) / d : 0;
        // Closing: the gap shrinking along the line between them, whoever walks. The simulation's Bump Staggers from
        // `MOVING_SEGMENT_STAGGER_SPEED` of it (`BUMP_IMPULSE_SCALE` is `MOVING_SEGMENT_IMPACT_SCALE`).
        const closing = (o.vx - m.vx) * ux + (o.vz - m.vz) * uz;
        if (closing >= MOVING_SEGMENT_STAGGER_SPEED) {
          bumped = true;
          break;
        }
        // A contact is a shove: two capsules resolve apart, half the overlap each. Over a drop, that is a Fall.
        crowd += 1 + BOT_PLAN_CROWD_EDGE_COST * edgeCloseness(px, pz);
        const sx = m.x;
        const sz = m.z;
        m.x += (ux * (TOUCH - d)) / 2;
        m.z += (uz * (TOUCH - d)) / 2;
        if (off(sx, sz, m.x, m.z)) {
          edge = true;
          break;
        }
      }
    }
    const progress = goal === null ? 0 : d0 - groundDistance({ x: m.x, y: 0, z: m.z }, goal);
    const deviation = candidate.direction === null || ask.holdHere === true ? 0 : 1 - (candidate.direction.x * ask.asked.x + candidate.direction.z * ask.asked.z);
    const score =
      BOT_PLAN_PROGRESS_WEIGHT * progress -
      (staggered || bumped ? BOT_PLAN_STAGGER_COST : 0) -
      BOT_PLAN_CONTACT_COST * contact -
      BOT_PLAN_CROWD_CONTACT_COST * crowd -
      (edge ? BOT_PLAN_EDGE_COST : 0) -
      BOT_PLAN_DEVIATION_COST * deviation +
      (candidate.name === this.lastName ? BOT_PLAN_KEEP_BONUS : 0) +
      (others.length > 0 && candidate.turn * this.side > 0 ? BOT_PLAN_SIDE_BIAS : 0);
    return { candidate, score, progress, staggered, contact, edge, stopped, stoppedAt, bumped, crowd };
  }
}
