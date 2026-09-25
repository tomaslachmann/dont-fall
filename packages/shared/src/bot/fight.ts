import { wrapAngle } from "../math/angle.js";
import { vec3, type Vec3 } from "../math/vec3.js";
import { isDownMotionState } from "../simulation/CharacterStateMachine.js";
import { forwardOf, spinAngleAt, spinSpeedAt, spinTangentOf, spinWindup } from "../simulation/spin.js";
import type { CharacterSnapshot } from "../state/SimState.js";
import {
  BOT_AIM_COS,
  BOT_BEHIND_CHECKPOINTS,
  BOT_BEHIND_FIGHT_SCALE,
  BOT_BOMB_GROUP_MIN,
  BOT_BOMB_LAST_THROW_S,
  BOT_BOMB_PICKUP_FUSE_MIN_S,
  BOT_CARRY_LOOK_TICKS,
  BOT_CATCH_REACTION_TICKS_MAX,
  BOT_CATCH_WATCH_M,
  BOT_EDGE_SEARCH_M,
  BOT_FIGHT_DECIDE_TICKS,
  BOT_FIGHT_GIVE_UP_TICKS,
  BOT_FIGHT_HEIGHT_M,
  BOT_FIGHT_REST_TICKS,
  BOT_FIGHT_SEEK_M,
  BOT_FIGHT_STANDOFF_M,
  BOT_HURL_EDGE_MAX_M,
  BOT_HURL_EDGE_MIN_M,
  BOT_HURL_WINDUP_MIN,
  BOT_PROP_PATH_COS,
  BOT_PROP_SEEK_M,
  BOT_PROP_STANDOFF_M,
  BOT_SPIN_GIVE_UP_MARGIN_TICKS,
  BOT_STRUGGLE_WIGGLES_PER_S_CLUMSY,
  BOT_STRUGGLE_WIGGLES_PER_S_STEADY,
  BOT_STUMBLE_EXTRA_TICKS_MAX,
  BOT_THROW_FACING_TOLERANCE,
  BOT_THROW_LOOK_TICKS,
  BOT_THROW_RANGE_M,
  BOT_TOSS_RANGE_M,
} from "../tuning/bots.js";
import { TICK_DT, TICK_MS } from "../tuning/clock.js";
import {
  GRAB_FACING_COS_MIN,
  GRAB_RANGE,
  HIT_CHARGE_IMPACT_BONUS,
  HIT_CHARGE_MAX_TICKS,
  HIT_IMPACT_MAGNITUDE,
  HURLED_BODY_MIN_SPEED,
  PROP_LIFT_TICKS,
  PROP_TOSS_RELEASE_TICKS,
  SPIN_OVERSPIN_TICKS,
  SPIN_WINDUP_TICKS,
} from "../tuning/fight.js";
import { IMPACT_RAGDOLL_MIN } from "../tuning/knockdown.js";
import type { BotWorldView } from "./Bot.js";
import {
  bombGroupSpot,
  facingOf,
  fightCandidates,
  fightRunClear,
  flatDirection,
  fuseLeft,
  groundDistance,
  isBomb,
  liftable,
  nearestVoids,
  pickFightTarget,
  staleReach,
  turned,
  type FightCandidate,
} from "./fightSense.js";
import type { BotProfile } from "./profile.js";
import { botDraw, botRandom } from "./random.js";

/**
 * What the Fight asks of a Bot's Character this Tick (M17 ticket 09): where
 * to walk, which way to turn the body while standing (`face`, turned by the
 * same rule a Player's client turns it, ADR 0085), and the two buttons as
 * held states — the simulation derives the presses itself (ADR 0003).
 */
export interface FightOrder {
  readonly moveDirection: Vec3;
  /** Turn the body toward this while `moveDirection` is zero; `null` turns it along the walk, as the run does. */
  readonly face: Vec3 | null;
  readonly hitHeld: boolean;
  readonly grabHeld: boolean;
}

/** How many of each thing this Bot's Fight has done: what the suite measures, and nothing reads back. */
export interface FightTally {
  /** Swings let go of at someone: a Hit charged to knock down. */
  strikes: number;
  /** Grabs reached at someone. */
  catches: number;
  /** Grabs reached at a Prop or a Bomb lying in the way. */
  lifts: number;
  /** Spins let go of: a Hurl, of a Character or a Prop. */
  hurls: number;
  /** Props (Bombs included) Tossed. */
  tosses: number;
  /** Lit Bombs thrown, Tossed or Hurled. */
  bombThrows: number;
  /** Shooter's Bombs reached for in flight (HARD). */
  bombCatches: number;
  /** Characters and Props let go of with nothing to throw them at. */
  drops: number;
}

type Plan =
  | { kind: "idle" }
  /** Charging a Hit at `target`, closing on it, letting go when in reach and charged to knock down. */
  | { kind: "strike"; target: string; since: number; charged: number; offset: number }
  /** Closing on `target` to Grab it; `pressedAt` once the reach went out. */
  | { kind: "catch"; target: string; since: number; pressedAt: number | null; offset: number }
  /** Closing on the Prop at `prop` to Lift it (ADR 0128); `pressedAt` once the reach went out. */
  | { kind: "lift"; prop: number; since: number; pressedAt: number | null }
  /** A Character in hand: looking for an edge, carrying toward one. */
  | { kind: "carry"; since: number; offset: number }
  /** Spinning what it holds, to let go when the Hurl's tangent points along `aim` (ADR 0104). */
  | { kind: "spin"; aim: Vec3; sent: number; start: number | null; bomb: boolean }
  /** A Prop in hand, Lifted: turning to its target to Toss it; `tapped` once Hit was tapped. */
  | { kind: "throw"; since: number; tapped: number | null; offset: number; away: Vec3 }
  /** Letting go of what it holds, with nothing to throw it at. */
  | { kind: "drop" }
  /** HARD: facing a Shooter's Bomb flying in, to catch it (ADR 0127). */
  | { kind: "brace"; prop: number; since: number; pressedAt: number | null };

const STAND = vec3();

/** Below this speed (u/s) a Bot is standing, and its heading is its body's. */
const HEADING_MIN_SPEED = 0.5;

/**
 * The Hit charge, in Ticks, that knocks down: where a charged Impact
 * (`hitImpactMagnitude`) crosses `IMPACT_RAGDOLL_MIN`, and one more so a Tick
 * lost to the release never leaves it short.
 */
const knockdownChargeTicks = (): number => {
  const fraction = Math.max(0, (IMPACT_RAGDOLL_MIN - HIT_IMPACT_MAGNITUDE) / HIT_CHARGE_IMPACT_BONUS);
  return Math.min(HIT_CHARGE_MAX_TICKS, Math.ceil(fraction * HIT_CHARGE_MAX_TICKS) + 1);
};

/** Whether a body turned to `facing` faces along `direction` within `cosMin`. */
const faces = (facing: number, direction: Vec3, cosMin: number): boolean => Math.cos(wrapAngle(facing - facingOf(direction))) >= cosMin;

/**
 * A Bot's Fight (M17 ticket 09, ADR 0129): the one slot of its tree that
 * takes its chance on whoever is at hand. Hit, Grab with its Spin and Hurl, a
 * Prop's Lift and Toss, a Bomb, and — in the Recover slot — the Struggle.
 *
 * It decides once a Tick from the view, like everything in a Bot, and keeps
 * one plan between Ticks. Its view is a few Ticks late (`withPerceptionDelay`),
 * so what it did shows up late: after letting go it waits to see empty hands
 * before it believes it, standing where it is meanwhile.
 *
 * Never suicidal (ADR 0129, the user's rule): it only ever walks a straight
 * run the navmesh holds all the way, over floor it can stop on, and stops
 * short of its target by what its own lateness can carry it; it Spins
 * standing still, never within {@link BOT_HURL_EDGE_MIN_M} of a void, and
 * lets a Hurl go along the Spin's own tangent, so the release moves nobody
 * but the one thrown. Everything random comes from its seed.
 */
export class Fighter {
  readonly tally: FightTally = { strikes: 0, catches: 0, lifts: 0, hurls: 0, tosses: 0, bombThrows: 0, bombCatches: 0, drops: 0 };
  private plan: Plan = { kind: "idle" };
  private readonly random: () => number;
  private restUntil = 0;
  private lastDecide = -Infinity;
  /** After letting go: the Tick until which a view still showing full hands is only late, not true. */
  private settleUntil = -Infinity;
  private lastHit = false;
  private lastGrab = false;
  /** Where a caught Shooter's Bomb came from: where it goes back to (ADR 0127). */
  private returnDir: Vec3 | null = null;
  private wigglePhase = 0;

  constructor(
    private readonly seed: string,
    private readonly profile: BotProfile,
  ) {
    this.random = botRandom(`${seed}\u0000fight`);
  }

  /** Whether a plan is under way: the run neither Dashes nor steers while it is. */
  get engaged(): boolean {
    return this.plan.kind !== "idle";
  }

  /** The Character this Fight is after, if its plan names one (M17 ticket 14, phase 3: left out of the crowd the run plans round). */
  get targetId(): string | null {
    const { plan } = this;
    return plan.kind === "strike" || plan.kind === "catch" ? plan.target : null;
  }

  /** Knocked about, Held, fallen: every plan is off, and nothing is pressed. */
  reset(): void {
    this.plan = { kind: "idle" };
    this.lastHit = false;
    this.lastGrab = false;
    this.returnDir = null;
    this.settleUntil = -Infinity;
  }

  /**
   * The Struggle (ADR 0104), for the Recover slot: A and D in turn, at this
   * Bot's rate, which its clumsiness sets between
   * {@link BOT_STRUGGLE_WIGGLES_PER_S_STEADY} and
   * {@link BOT_STRUGGLE_WIGGLES_PER_S_CLUMSY}. Every change of side is one
   * wiggle, a reversal of the move input the escape meter counts.
   */
  struggle(): Vec3 {
    const rate =
      BOT_STRUGGLE_WIGGLES_PER_S_STEADY + (BOT_STRUGGLE_WIGGLES_PER_S_CLUMSY - BOT_STRUGGLE_WIGGLES_PER_S_STEADY) * this.profile.clumsiness;
    this.wigglePhase += rate * TICK_DT;
    return Math.floor(this.wigglePhase) % 2 === 0 ? vec3(1, 0, 0) : vec3(-1, 0, 0);
  }

  /**
   * This Tick's order, or `null` when the Fight has nothing to do and the
   * Round's goal runs. `facing` is the facing the Bot last sent: where its
   * body is, as near as it knows.
   */
  think(view: BotWorldView, facing: number): FightOrder | null {
    const order = this.decide(view, facing);
    this.lastHit = order?.hitHeld ?? false;
    this.lastGrab = order?.grabHeld ?? false;
    return order;
  }

  /** Ticks a Bot waits to see what it just did: its reaction, its worst stumble, and two for the step. */
  private get grace(): number {
    return this.profile.reactionTicks + BOT_STUMBLE_EXTRA_TICKS_MAX + 2;
  }

  private decide(view: BotWorldView, facing: number): FightOrder | null {
    const { self, tick } = view;
    if (self.finishTick !== null || self.eliminated) {
      this.reset();
      return null;
    }
    const holding = self.grabbingId !== null;
    const handsFull = holding || self.carryingProp !== null;
    // A Lift owns the hands and the feet until it is done (ADR 0128).
    if (self.liftStartTick !== null) return this.stand();

    if (tick < this.settleUntil) {
      if (handsFull) return this.stand();
      this.settleUntil = -Infinity;
    }
    // What it holds, as the view shows it, whatever the plan thought: a reach
    // at a Prop that caught a Character instead, a catch seen late.
    if (holding && !["carry", "spin", "drop"].includes(this.plan.kind)) this.plan = { kind: "carry", since: tick, offset: this.aimOffset() };
    else if (self.carryingProp !== null && !["throw", "spin", "drop"].includes(this.plan.kind)) {
      this.plan = { kind: "throw", since: tick, tapped: null, offset: this.aimOffset(), away: this.away(self, facing) };
    }

    switch (this.plan.kind) {
      case "idle":
        return handsFull ? null : this.look(view, facing);
      case "strike":
        return this.strike(view, this.plan, facing);
      case "catch":
        return this.reach(view, this.plan, facing);
      case "lift":
        return this.lift(view, this.plan, facing);
      case "carry":
        return this.carry(view, this.plan);
      case "spin":
        return this.spin(view, this.plan);
      case "throw":
        return this.throw(view, this.plan);
      case "drop":
        return this.drop(tick);
      case "brace":
        return this.brace(view, this.plan, facing);
    }
  }

  private stand(face: Vec3 | null = null): FightOrder {
    return { moveDirection: STAND, face, hitHeld: false, grabHeld: false };
  }

  /** The plan is over: run on, and look for no other fight for a while. */
  private finish(tick: number): null {
    this.plan = { kind: "idle" };
    this.restUntil = tick + BOT_FIGHT_REST_TICKS;
    this.returnDir = null;
    return null;
  }

  /** Let go of what it holds this Tick, and stand until the view shows it gone. */
  private letGo(tick: number, order: FightOrder): FightOrder {
    this.finish(tick);
    this.settleUntil = tick + this.grace;
    return order;
  }

  /** How far off a Bot aims this fight, drawn once: its `aimError` either way. */
  private aimOffset(): number {
    return (this.random() * 2 - 1) * this.profile.aimError;
  }

  /** Which way a Bot is going: along its run when it runs, along its body when it stands. */
  private heading(self: Readonly<CharacterSnapshot>, facing: number): Vec3 {
    const speed = Math.hypot(self.velocity.x, self.velocity.z);
    return speed > HEADING_MIN_SPEED ? vec3(self.velocity.x / speed, 0, self.velocity.z / speed) : forwardOf(facing);
  }

  /** Back the way it came: where a lit Bomb with nobody to throw it at goes. */
  private away(self: Readonly<CharacterSnapshot>, facing: number): Vec3 {
    const heading = this.heading(self, facing);
    return vec3(-heading.x, 0, -heading.z);
  }

  /**
   * Closing on `target` for a fight: a step toward it while the straight run
   * to it stays on the navmesh, or standing, turned to it, once it is within
   * `standoff` and what this Bot's own lateness can carry it. `null` when the
   * run is not one to take.
   */
  private approach(view: BotWorldView, target: Vec3, standoff: number, facing: number): { move: Vec3; dir: Vec3; arrived: boolean } | null {
    const { self } = view;
    const dir = flatDirection(self.position, target) ?? forwardOf(facing);
    if (groundDistance(self.position, target) <= standoff + staleReach(self, this.profile)) return { move: STAND, dir, arrived: true };
    if (!fightRunClear(view.track.nav, self.position, target)) return null;
    return { move: dir, dir, arrived: false };
  }

  /** An idle Bot, every {@link BOT_FIGHT_DECIDE_TICKS}: is there a chance worth its aggression? */
  private look(view: BotWorldView, facing: number): FightOrder | null {
    const { self, tick } = view;
    const incoming = this.bombToCatch(view);
    if (incoming !== null) {
      this.plan = { kind: "brace", prop: incoming, since: tick, pressedAt: null };
      return this.brace(view, this.plan, facing);
    }
    if (tick < this.restUntil || tick - this.lastDecide < BOT_FIGHT_DECIDE_TICKS) return null;
    this.lastDecide = tick;
    if (self.dashing || self.motionState !== "Controlled" || !self.grounded) return null;
    if (this.random() >= this.profile.aggression * (this.farBehind(view) ? BOT_BEHIND_FIGHT_SCALE : 1)) return null;

    const heading = this.heading(self, facing);
    const grabReady = self.grabCooldownMs === 0;
    if (grabReady) {
      const prop = this.propInPath(view, heading);
      if (prop !== null) {
        this.plan = { kind: "lift", prop, since: tick, pressedAt: null };
        return this.lift(view, this.plan, facing);
      }
    }
    const best = pickFightTarget(fightCandidates(view, heading, "catch"), this.random);
    if (best === null) return null;
    const down = isDownMotionState(view.characters[best.id]!.motionState);
    const strikeReady = self.hitCooldownMs === 0 && !down;
    if (grabReady && best.exposure > 0 && (down || !strikeReady || this.random() < this.profile.chanceTaking)) {
      this.plan = { kind: "catch", target: best.id, since: tick, pressedAt: null, offset: this.aimOffset() };
      return this.reach(view, this.plan, facing);
    }
    if (!strikeReady) return null;
    this.plan = { kind: "strike", target: best.id, since: tick, charged: 0, offset: this.aimOffset() };
    return this.strike(view, this.plan, facing);
  }

  /** Whether this Bot is far behind the leader: it fights less and runs more. */
  private farBehind(view: BotWorldView): boolean {
    let leader = -1;
    for (const other of Object.values(view.characters)) if (!other.eliminated) leader = Math.max(leader, other.checkpointIndex ?? -1);
    return leader - (view.self.checkpointIndex ?? -1) >= BOT_BEHIND_CHECKPOINTS;
  }

  /** A target still worth the fight: in the Round, running, and in nobody's hold. */
  private target(view: BotWorldView, id: string): Readonly<CharacterSnapshot> | null {
    const other = view.characters[id];
    if (!other || other.eliminated || other.finishTick !== null || other.motionState === "Held") return null;
    if (other.grabbingId !== null || other.heldByGrabberId !== null) return null;
    if (groundDistance(view.self.position, other.position) > BOT_FIGHT_SEEK_M * 1.5) return null;
    if (Math.abs(other.position.y - view.self.position.y) > BOT_FIGHT_HEIGHT_M) return null;
    return other;
  }

  /** A Hit (ADR 0093, M6.1): charge while closing, let go in reach once the charge knocks down. */
  private strike(view: BotWorldView, plan: Extract<Plan, { kind: "strike" }>, facing: number): FightOrder | null {
    const { tick } = view;
    const target = this.target(view, plan.target);
    if (target === null || isDownMotionState(target.motionState) || tick - plan.since > BOT_FIGHT_GIVE_UP_TICKS) return this.finish(tick);
    const close = this.approach(view, target.position, BOT_FIGHT_STANDOFF_M, facing);
    if (close === null) return this.finish(tick);
    const aim = turned(close.dir, plan.offset);
    if (close.arrived && plan.charged >= knockdownChargeTicks() && faces(facing, aim, BOT_AIM_COS)) {
      this.tally.strikes += 1;
      this.finish(tick);
      return this.stand(aim);
    }
    plan.charged += 1;
    return { moveDirection: close.move, face: close.arrived ? aim : null, hitHeld: true, grabHeld: false };
  }

  /** A Grab at a Character (ADR 0104): close, turn, reach; the catch shows up in the view as `grabbingId`. */
  private reach(view: BotWorldView, plan: Extract<Plan, { kind: "catch" }>, facing: number): FightOrder | null {
    const { self, tick } = view;
    if (plan.pressedAt !== null) return tick - plan.pressedAt > this.grace ? this.finish(tick) : this.stand();
    const target = this.target(view, plan.target);
    if (target === null || tick - plan.since > BOT_FIGHT_GIVE_UP_TICKS) return this.finish(tick);
    const close = this.approach(view, target.position, BOT_FIGHT_STANDOFF_M, facing);
    if (close === null) return this.finish(tick);
    const aim = turned(close.dir, plan.offset);
    if (close.arrived && faces(facing, aim, BOT_AIM_COS) && self.grabCooldownMs === 0 && !self.dashing && !this.lastGrab) {
      plan.pressedAt = tick;
      this.tally.catches += 1;
      return { moveDirection: STAND, face: aim, hitHeld: false, grabHeld: true };
    }
    return { moveDirection: close.move, face: close.arrived ? aim : null, hitHeld: false, grabHeld: false };
  }

  /**
   * A Prop lying in the way worth picking up (ADR 0125): close ahead, light
   * enough, with someone to throw it at — for a Bomb, a group — and a straight
   * run to it.
   */
  private propInPath(view: BotWorldView, heading: Vec3): number | null {
    const { self } = view;
    let best: number | null = null;
    let bestDistance = Infinity;
    (view.props ?? []).forEach((prop, index) => {
      if (!liftable(view, index, BOT_BOMB_PICKUP_FUSE_MIN_S)) return;
      const distance = groundDistance(self.position, prop.position);
      const dir = flatDirection(self.position, prop.position);
      if (distance > BOT_PROP_SEEK_M || distance >= bestDistance || Math.abs(prop.position.y - self.position.y) > 2 * BOT_FIGHT_HEIGHT_M) return;
      if (dir !== null && dir.x * heading.x + dir.z * heading.z < BOT_PROP_PATH_COS) return;
      if (!this.throwSpot(view, isBomb(view, index))) return;
      if (!fightRunClear(view.track.nav, self.position, prop.position)) return;
      best = index;
      bestDistance = distance;
    });
    return best;
  }

  /**
   * Where a thrown Prop goes: a Bomb at a group (never so near the Bot the
   * blast knocks it down), anything else at whoever is most worth it within
   * {@link BOT_THROW_RANGE_M} — by the same distance and exposure a fight is
   * chosen by.
   */
  private throwSpot(view: BotWorldView, bomb: boolean): Vec3 | null {
    const { self } = view;
    if (bomb) return bombGroupSpot(view, self.position, BOT_THROW_RANGE_M, BOT_BOMB_GROUP_MIN);
    const candidates: FightCandidate[] = [];
    for (const [id, other] of Object.entries(view.characters)) {
      if (id === view.id || other.eliminated || other.finishTick !== null || other.motionState === "Held") continue;
      const distance = groundDistance(self.position, other.position);
      if (distance > BOT_THROW_RANGE_M || Math.abs(other.position.y - self.position.y) > 2 * BOT_FIGHT_HEIGHT_M) continue;
      candidates.push({ id, distance, exposure: 0, score: 1 - distance / BOT_THROW_RANGE_M });
    }
    const best = pickFightTarget(candidates, this.random);
    return best === null ? null : view.characters[best.id]!.position;
  }

  /** A Lift (ADR 0128): close on the Prop, reach for it, and stand while the rig bends down for it. */
  private lift(view: BotWorldView, plan: Extract<Plan, { kind: "lift" }>, facing: number): FightOrder | null {
    const { self, tick } = view;
    if (plan.pressedAt !== null) {
      return tick - plan.pressedAt > PROP_LIFT_TICKS + this.grace ? this.finish(tick) : this.stand();
    }
    const prop = view.props?.[plan.prop];
    if (!prop || !liftable(view, plan.prop, BOT_BOMB_PICKUP_FUSE_MIN_S) || tick - plan.since > BOT_FIGHT_GIVE_UP_TICKS) return this.finish(tick);
    const close = this.approach(view, prop.position, BOT_PROP_STANDOFF_M, facing);
    if (close === null) return this.finish(tick);
    if (close.arrived && faces(facing, close.dir, BOT_AIM_COS) && self.grabCooldownMs === 0 && !self.dashing && !this.lastGrab) {
      plan.pressedAt = tick;
      this.tally.lifts += 1;
      return { moveDirection: STAND, face: close.dir, hitHeld: false, grabHeld: true };
    }
    return { moveDirection: close.move, face: close.arrived ? close.dir : null, hitHeld: false, grabHeld: false };
  }

  /**
   * A Character in hand (ADR 0104): Spin toward the nearest void within a
   * Hurl's reach; carry toward one a little farther, along a run the navmesh
   * holds; otherwise — or with any void nearer than
   * {@link BOT_HURL_EDGE_MIN_M}, where a dizzy fall could roll the Bot itself
   * off — let go and run on.
   */
  private carry(view: BotWorldView, plan: Extract<Plan, { kind: "carry" }>): FightOrder | null {
    const { self, tick, track } = view;
    if (self.grabbingId === null) return tick - plan.since > this.grace ? this.finish(tick) : this.stand();
    const voids = nearestVoids(track.nav, self.position, BOT_EDGE_SEARCH_M);
    const nearest = voids[0];
    if (nearest === undefined || nearest.distance < BOT_HURL_EDGE_MIN_M) return this.startDrop(tick);
    if (nearest.distance <= BOT_HURL_EDGE_MAX_M) {
      this.plan = { kind: "spin", aim: turned(nearest.direction, plan.offset), sent: 0, start: null, bomb: false };
      return this.spin(view, this.plan);
    }
    const stop = nearest.distance - BOT_HURL_EDGE_MIN_M;
    const to = { x: self.position.x + nearest.direction.x * stop, y: self.position.y, z: self.position.z + nearest.direction.z * stop };
    if (tick - plan.since <= BOT_CARRY_LOOK_TICKS && fightRunClear(track.nav, self.position, to)) {
      return { moveDirection: nearest.direction, face: null, hitHeld: false, grabHeld: false };
    }
    return this.startDrop(tick);
  }

  /**
   * A Spin (ADR 0104), standing still: Hit held, counting its own Ticks, and
   * let go on the Tick the Hurl's tangent — the Spin's own facing at that
   * count, from where the view shows it started — points along `aim`. With no
   * move input on that Tick the Hurl leaves along the tangent itself, so the
   * release moves only the one thrown.
   */
  private spin(view: BotWorldView, plan: Extract<Plan, { kind: "spin" }>): FightOrder | null {
    const { self, tick } = view;
    const handsFull = self.grabbingId !== null || self.carryingProp !== null;
    if (!handsFull && plan.sent > this.grace) return this.finish(tick);
    // The view is late, but a Spin is a pure function of its count (`spin.ts`):
    // any Tick of it the view shows says where it started.
    if (self.spinMs > 0) plan.start = self.facing - spinAngleAt(Math.round(self.spinMs / TICK_MS));
    const n = plan.sent;
    let release = n >= SPIN_WINDUP_TICKS + SPIN_OVERSPIN_TICKS - BOT_SPIN_GIVE_UP_MARGIN_TICKS;
    if (!release && plan.start !== null && spinWindup(n) >= BOT_HURL_WINDUP_MIN) {
      const along = facingOf(spinTangentOf(plan.start + spinAngleAt(n)));
      const step = Math.max(spinSpeedAt(n), spinSpeedAt(n + 1)) * TICK_DT;
      release = Math.abs(wrapAngle(along - facingOf(plan.aim))) <= step / 2 + 1e-9;
    }
    if (release) {
      this.tally.hurls += 1;
      if (plan.bomb) this.tally.bombThrows += 1;
      return this.letGo(tick, this.stand());
    }
    plan.sent += 1;
    return { moveDirection: STAND, face: null, hitHeld: true, grabHeld: false };
  }

  /**
   * A Prop in hand, Lifted (ADR 0125/0128): turn to where it goes, then tap
   * Hit — a Toss, which winds up standing and lets go along the facing — or,
   * for a target past {@link BOT_TOSS_RANGE_M}, Spin and Hurl it. A lit Bomb
   * goes at a group, back at its Shooter, or away, and is thrown whatever
   * the aim once its fuse is short: never held to the end (ADR 0129).
   */
  private throw(view: BotWorldView, plan: Extract<Plan, { kind: "throw" }>): FightOrder | null {
    const { self, tick } = view;
    const index = self.carryingProp;
    if (plan.tapped !== null) {
      if (index === null || tick - plan.tapped > PROP_TOSS_RELEASE_TICKS + this.grace) return this.finish(tick);
      return this.stand();
    }
    if (index === null) return tick - plan.since > this.grace ? this.finish(tick) : this.stand();
    const bomb = isBomb(view, index);
    const left = fuseLeft(view, index);
    const urgent = left !== null && left <= BOT_BOMB_LAST_THROW_S;
    const spot = bomb && this.returnDir !== null ? null : this.throwSpot(view, bomb);
    let aim = spot === null ? null : flatDirection(self.position, spot);
    if (aim === null && bomb) aim = this.returnDir ?? plan.away;
    if (aim === null) return tick - plan.since > BOT_THROW_LOOK_TICKS ? this.startDrop(tick) : this.stand();
    aim = turned(aim, plan.offset);
    if (!bomb && spot !== null && groundDistance(self.position, spot) > BOT_TOSS_RANGE_M) {
      this.plan = { kind: "spin", aim, sent: 0, start: null, bomb: false };
      return this.spin(view, this.plan);
    }
    if ((urgent || Math.abs(wrapAngle(self.facing - facingOf(aim))) <= BOT_THROW_FACING_TOLERANCE) && !this.lastHit) {
      plan.tapped = tick;
      this.tally.tosses += 1;
      if (bomb) this.tally.bombThrows += 1;
      return { moveDirection: STAND, face: aim, hitHeld: true, grabHeld: false };
    }
    return this.stand(aim);
  }

  private startDrop(tick: number): FightOrder {
    this.plan = { kind: "drop" };
    return this.drop(tick);
  }

  /** Let go on purpose (ADR 0093): a press of Grab with full hands. */
  private drop(tick: number): FightOrder {
    // A press is a rising edge: after a held Tick, one up first.
    if (this.lastGrab) return this.stand();
    this.tally.drops += 1;
    return this.letGo(tick, { moveDirection: STAND, face: null, hitHeld: false, grabHeld: true });
  }

  /**
   * A Shooter's Bomb flying at this Bot that it will try to catch (ADR 0127):
   * only with HARD's reflexes ({@link BOT_CATCH_REACTION_TICKS_MAX}), hands
   * empty and Grab ready, and once per shot by its `chanceTaking`.
   */
  private bombToCatch(view: BotWorldView): number | null {
    const { self } = view;
    if (this.profile.reactionTicks > BOT_CATCH_REACTION_TICKS_MAX) return null;
    if (self.grabCooldownMs > 0 || self.dashing || self.motionState !== "Controlled") return null;
    const props = view.props ?? [];
    for (let index = 0; index < props.length; index += 1) {
      const config = view.track.resolved.props[index];
      if (config?.projectile !== true || config.bomb === undefined || !this.incoming(view, index)) continue;
      const shot = view.bombs?.find((b) => b.propIndex === index)?.detonateTick ?? 0;
      if (botDraw(this.seed, `catch ${index}:${shot}`) < this.profile.chanceTaking) return index;
    }
    return null;
  }

  /** Whether the Prop at `index` is flying in at this Bot, near enough to watch. */
  private incoming(view: BotWorldView, index: number): boolean {
    const { self } = view;
    const prop = view.props?.[index];
    if (!prop || prop.live === false || prop.carriedBy !== undefined || !prop.velocity) return false;
    const v = prop.velocity;
    if (Math.hypot(v.x, v.y, v.z) < HURLED_BODY_MIN_SPEED) return false;
    if (groundDistance(self.position, prop.position) > BOT_CATCH_WATCH_M) return false;
    return v.x * (self.position.x - prop.position.x) + v.z * (self.position.z - prop.position.z) > 0;
  }

  /** HARD's catch (ADR 0127): face the Bomb flying in, and reach as it comes into reach. */
  private brace(view: BotWorldView, plan: Extract<Plan, { kind: "brace" }>, facing: number): FightOrder | null {
    const { self, tick } = view;
    if (plan.pressedAt !== null) return tick - plan.pressedAt > this.grace ? this.finish(tick) : this.stand();
    const prop = view.props?.[plan.prop];
    if (!prop || !prop.velocity || !this.incoming(view, plan.prop) || tick - plan.since > BOT_FIGHT_GIVE_UP_TICKS) return this.finish(tick);
    const v = prop.velocity;
    // Where it will be on the Tick the reach resolves.
    const next = { x: prop.position.x + v.x * TICK_DT, y: prop.position.y + v.y * TICK_DT, z: prop.position.z + v.z * TICK_DT };
    const dir = flatDirection(self.position, next) ?? forwardOf(facing);
    const inReach = groundDistance(self.position, next) <= GRAB_RANGE && Math.abs(next.y - self.position.y) <= 2 * BOT_FIGHT_HEIGHT_M;
    if (inReach && faces(facing, dir, GRAB_FACING_COS_MIN) && !this.lastGrab) {
      plan.pressedAt = tick;
      this.tally.bombCatches += 1;
      this.returnDir = flatDirection(vec3(), vec3(-v.x, 0, -v.z));
      return { moveDirection: STAND, face: dir, hitHeld: false, grabHeld: true };
    }
    return this.stand(dir);
  }
}
