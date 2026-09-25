import { addVec3, dotVec3, lengthVec3, normalizeVec3, scaleVec3, subVec3, vec3, type Vec3 } from "../math/vec3.js";
import type { HeldPhase, EliminationHow } from "../state/SimState.js";
import { CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS } from "../tuning/character.js";
import { MOVING_SEGMENT_LIFT_RATIO, PROJECTILE_MASS } from "../tuning/world.js";
import {
  DIZZY_FLING_FRACTION,
  GRAB_CARRY_TICKS,
  GRAB_ESCAPE_SHOVE_SPEED,
  GRAB_FACING_COS_MIN,
  GRAB_IMMUNITY_TICKS,
  GRAB_RANGE,
  GRAB_STRUGGLE_WINDOW_TICKS,
  HURL_AIM_SNAP_COS,
  GRAB_GRIP_ABOVE_CHEST,
  HURL_LIFT_SPEED,
  HURL_MAX_SPEED,
  HURL_MIN_SPEED,
  HURLED_BODY_FLIGHT_TICKS,
  HURLED_BODY_MIN_SPEED,
  PROP_LIFT_CONTACT_TICKS,
  PROP_LIFT_TICKS,
  PROP_TOSS_LIFT,
  PROP_TOSS_RELEASE_LIFT,
  PROP_TOSS_RELEASE_REACH,
  PROP_TOSS_SPEED,
  PROP_TOSS_TAP_TICKS,
  SPIN_ESCAPE_FLING_FRACTION,
  SWUNG_BODY_IMPACT_SCALE,
  SWUNG_BODY_LIFT_RATIO,
  SWUNG_BODY_REACH,
  SWUNG_BODY_REHIT_TICKS,
} from "../tuning/fight.js";
import type { CharacterController } from "./CharacterController.js";
import { isDownMotionState, isPlayerDrivenMotionState } from "./CharacterStateMachine.js";
import { movingSegmentImpactMagnitude } from "./MovingSegment.js";
import type { Prop } from "./Prop.js";
import { canLiftProp, CARRY_GRIP, liftHolds, propGripOffset, propThrowScale, SPIN_GRIP } from "./propCarry.js";
import type { SimInputs } from "./SimInputs.js";
import { carrySpeedAt, forwardOf, spinTangentOf } from "./spin.js";

/** One Grab hold in progress (ADR 0104) — see {@link GrabHolds}. */
interface ActiveGrab {
  heldId: string;
  /** Which part of the hold the held Character is in: its Struggle, or Limp. */
  phase: HeldPhase;
  /** Ticks left in the current phase's window — the Struggle's, then the grabber's Limp window. */
  ticksLeft: number;
}

/** A hurled body still in the air (ADR 0104), and who it has already hit on the way. */
interface Flight {
  ticksLeft: number;
  hit: Set<string>;
  /** Who threw it — what anyone it lands on is knocked out by (ADR 0110). */
  byId: string;
}

/**
 * A Prop being carried (ADR 0125) — by its index among the simulation's
 * Props — or being Lifted toward it (ADR 0128).
 */
interface PropHold {
  index: number;
  /** The Tick the Lift started, while it lasts; `null` once the Prop is up. */
  liftStartTick: number | null;
  /** Whether the hands have reached it: before the Lift's touch it still lies where it was, reserved. */
  attached: boolean;
}

/** A thrown Prop still flying (ADR 0125), and who it has already hit on the way. */
interface PropFlight {
  ticksLeft: number;
  hit: Set<string>;
  byId: string;
}

/** What a hold needs from the simulation around it. */
export interface HoldWorld {
  /**
   * Every Prop in the world, in the simulation's order (ADR 0125) — empty
   * where Props cannot be picked up: a client's own prediction, which learns
   * about a carry from the snapshot and never decides one.
   */
  liftableProps(): readonly Prop[];
  /** A Character still in the Match, by id. */
  character(id: string): CharacterController | undefined;
  /** Every Character in the Match, by id, in the simulation's own fixed order. */
  ids(): Iterable<string>;
  /** Whether `id` is out of the Round (ADR 0042) — inert: nobody holds it, it holds nobody, and nothing it is hit by lands. */
  eliminated(id: string): boolean;
  /** What `id` is actually driven by this tick — a lock or a finished Round idles it (`RapierSimulation.effectiveInput`). */
  effectiveInput(id: string, inputs: Record<string, SimInputs>, matchLocked: boolean): SimInputs;
  /** The nearest other Character in a cone ahead — the targeting Hit and Grab share (`RapierSimulation.findNearestInCone`). */
  nearestInCone(
    fromId: string,
    fromPos: Vec3,
    facing: number,
    range: number,
    facingCosMin: number,
    exclude: (id: string) => boolean,
  ): string | undefined;
  /** The current Tick, after the step. */
  tick(): number;
  /** A deterministic draw in [0, 1) for `id` this Tick (`slipRoll`) — the direction a dizzy grabber flings its held Character. */
  roll(id: string): number;
  /** Records that `byId` just grabbed, Hurled or hit `targetId` — what a knockout is credited to (ADR 0110). */
  credit(targetId: string, byId: string, how: EliminationHow): void;
  /** `byId` just picked up the Prop at `index` — what lights a Bomb (ADR 0126). */
  propLifted(index: number, byId: string): void;
  /** Records that `id` just won a Struggle — the career's GRABS BROKEN (ADR 0110). */
  struggleWon(id: string): void;
}

/**
 * Grab across Characters (M6 ticket 04, M6.1, ADR 0093, ADR 0104): starting a
 * hold, keeping it — the Struggle, going Limp, carrying the body where the
 * grabber goes — and every way it ends: a Struggle won, a let-go, a Hurl, a
 * dizzy grabber, the Limp window running out, either one leaving. Also what a
 * swung or hurled body does to the Characters it reaches, and Grab immunity.
 * The half of Grab that belongs to one Character — the verb, its cooldown,
 * the Struggle's meter, the Spin — is `InteractionController`'s; this is the
 * half neither side can decide alone, and the one place a change to how
 * holding works goes (ADR 0101).
 */
export class GrabHolds {
  /**
   * Every Grab hold currently in progress (M6 ticket 04), keyed by the
   * grabber's own id — a Character can only ever be the grabber in one hold
   * at a time, and the linear scan resolving/updating this each tick is
   * trivially cheap at ADR 0011's up-to-12-player scale. The relationship
   * itself lives here rather than on either `CharacterController`, since it's
   * inherently cross-Character state neither side can resolve alone —
   * exactly the same reasoning Hit's own targeting already established
   * (ticket 03).
   */
  private readonly holds = new Map<string, ActiveGrab>();
  /**
   * Grab immunity (ADR 0104): whoever a hold just let go of, and the ticks
   * left before anyone may grab it again — `null` while it has not yet got
   * back on its feet, since the immunity counts from standing, not from the
   * release.
   */
  private readonly immunity = new Map<string, number | null>();
  /** Hurled bodies still flying (ADR 0104), by the hurled Character's id. */
  private readonly flights = new Map<string, Flight>();
  /** The Tick a swung body last hit each Character, keyed `grabber>target` — once per pass, never once per tick of contact. */
  private readonly swingHits = new Map<string, number>();
  /** Every Prop being carried (ADR 0125), keyed by its carrier's id — one hold per grabber, of either kind. */
  private readonly propHolds = new Map<string, PropHold>();
  /** Thrown Props still flying (ADR 0125), by the Prop's index. */
  private readonly propFlights = new Map<number, PropFlight>();

  constructor(private readonly world: HoldWorld) {}

  /** Whether `id` is currently part of any Grab hold, as either the grabber or the one held (M6 ticket 04), or carrying a Prop (ADR 0125). */
  isGrabEngaged(id: string): boolean {
    return this.propHolds.has(id) || this.inCharacterHold(id);
  }

  /**
   * Whether `id` is at either end of a hold on a Character. A Prop's carrier
   * is not: it can still be grabbed, Hit or knocked into, and drops what it
   * carries when it is (ADR 0125).
   */
  private inCharacterHold(id: string): boolean {
    if (this.holds.has(id)) return true;
    for (const grab of this.holds.values()) if (grab.heldId === id) return true;
    return false;
  }

  /** Which Prop `id` is carrying, by index, or `undefined` (ADR 0125). */
  carriedPropOf(id: string): number | undefined {
    return this.propHolds.get(id)?.index;
  }

  /** Whether the Prop at `index` was thrown and is still flying (ADR 0125). */
  isPropFlying(index: number): boolean {
    return this.propFlights.has(index);
  }

  /** Whether `id` was let go of too recently to be grabbed again (ADR 0104). */
  isImmune(id: string): boolean {
    return this.immunity.has(id);
  }

  /**
   * Grab, initiation half (M6 ticket 04): latches onto the nearest OTHER
   * Character within {@link GRAB_RANGE} and within {@link GRAB_FACING_COS_MIN}
   * of the grabber's own facing — identical targeting shape to Hit, via the
   * same `findNearestInCone` — and picks it up (ADR 0104). One on its feet
   * gets its Struggle; one already down goes straight to Limp, having nothing
   * to wiggle with. Cancels the held Character's in-progress Dash the instant
   * the hold starts; the grabber's own can never be in progress, since Dash
   * gates Grab out entirely, same as Hit (M6.1).
   *
   * Runs before the step. The held body is first placed at the carry point
   * after it, by {@link updateGrabs}, like on every tick of the hold; the
   * grabber first walks loaded on the next tick, the same one-tick engage
   * latency Bump and Hit have.
   */
  resolveGrabInitiation(grabberId: string): void {
    const grabber = this.world.character(grabberId);
    if (!grabber || this.isGrabEngaged(grabberId)) return;
    const heldId = this.world.nearestInCone(
      grabberId,
      grabber.position,
      grabber.facing,
      GRAB_RANGE,
      GRAB_FACING_COS_MIN,
      // ADR 0093: a Character that is already down IS a valid target — ADR
      // 0104 carries it Limp. Excluded: anyone already in a hold (one hold at
      // a time, in one role), anyone just let go of (Grab immunity), and
      // anyone about to be put back at a Checkpoint.
      // ADR 0125: a Prop's carrier is still a Character to grab — it drops
      // what it carries.
      (id) => this.inCharacterHold(id) || this.isImmune(id) || this.world.character(id)!.hasPendingRespawn,
    );
    // ADR 0125: a Character first — a cone lying beside someone must not
    // steal the catch — and only then the nearest Prop that can be lifted.
    if (heldId === undefined) {
      this.pickUpProp(grabberId, grabber);
      return;
    }

    const held = this.world.character(heldId)!;
    this.dropProp(heldId);
    const down = isDownMotionState(held.motionState);
    this.holds.set(grabberId, {
      heldId,
      phase: down ? "limp" : "struggle",
      ticksLeft: down ? GRAB_CARRY_TICKS : GRAB_STRUGGLE_WINDOW_TICKS,
    });
    held.cancelDash();
    held.beginHeld();
    this.world.credit(heldId, grabberId, "grabbed");
  }

  /**
   * Both ends of every hold, told so before this tick's `beginTick` (ADR
   * 0104): the grabber walks loaded and its Hit button Spins; the held
   * Character Struggles, if it still can. Every Character has been
   * `clearHold()`ed first — "not engaged until proven otherwise".
   */
  assertBeforeStep(): void {
    for (const [carrierId, hold] of this.propHolds) {
      const prop = this.world.liftableProps()[hold.index];
      // ADR 0128: the Tick about to be stepped is `tick() + 1`.
      const lifting = hold.liftStartTick !== null && liftHolds(hold.liftStartTick, this.world.tick() + 1);
      if (prop) this.world.character(carrierId)?.holdAs("grabbing", null, prop.mass, lifting);
    }
    for (const [grabberId, grab] of this.holds) {
      this.world.character(grabberId)?.holdAs("grabbing");
      this.world.character(grab.heldId)?.holdAs("held", grab.phase);
    }
  }

  /**
   * Grab, maintenance half — called once per tick, after the step, once every
   * Character has moved (ADR 0104). For every hold, in order: does it still
   * exist at all; has the grabber gone down; did the grabber Hurl, get dizzy
   * or let go; did the held Character win its Struggle; has the current
   * window run out. Whatever survives all of that is carried: the held body
   * is put at its grabber's carry point, facing it, and both ends report the
   * hold on their snapshots. Then the swung and hurled bodies, and Grab
   * immunity.
   *
   * The grabber's own actions are read before the Struggle, so a Hurl and a
   * won Struggle on the same tick is a Hurl: the grabber decided first.
   */
  updateGrabs(inputs: Record<string, SimInputs>, matchLocked: boolean): void {
    for (const [grabberId, grab] of this.holds) {
      const grabber = this.world.character(grabberId);
      const held = this.world.character(grab.heldId);
      // Either end leaving the Round, or the held one no longer Held (an
      // eliminating Fall put it down) — nothing left to carry, and the body is
      // already whatever its own path made it.
      if (!grabber || !held || this.world.eliminated(grabberId) || this.world.eliminated(grab.heldId) || held.motionState !== "Held") {
        this.end(grabberId, grab.heldId);
        continue;
      }
      // Every tick of a hold, not only the catch: a long carry to the edge is
      // still the grabber's doing when the drop comes (ADR 0110).
      this.world.credit(grab.heldId, grabberId, "grabbed");
      // You cannot hold onto anything while going down, or falling off the
      // world: the held Character is let go of, however it was being held.
      // Nor carry a body that has fallen off it — let go, it takes its Respawn.
      if (!isPlayerDrivenMotionState(grabber.motionState) || grabber.hasPendingRespawn || held.hasPendingRespawn) {
        this.letGo(grabberId, grab, grabber, held);
        continue;
      }

      const hurl = grabber.takeHurl();
      if (hurl) {
        const aim = this.world.effectiveInput(grabberId, inputs, matchLocked).moveDirection;
        this.hurl(
          grabberId,
          grab.heldId,
          held,
          scaleVec3(hurlDirection(spinTangentOf(hurl.facing), aim), hurlSpeed(held, hurl.windup)),
        );
        continue;
      }
      if (grabber.takeDizzy()) {
        const angle = this.world.roll(grabberId) * Math.PI * 2;
        const away = vec3(Math.sin(angle), 0, -Math.cos(angle));
        this.hurl(grabberId, grab.heldId, held, scaleVec3(away, HURL_MAX_SPEED * DIZZY_FLING_FRACTION));
        grabber.knockDown("Dizzy");
        continue;
      }
      // ADR 0093: the grabber let go on purpose.
      if (grabber.takeGrabRelease()) {
        this.letGo(grabberId, grab, grabber, held);
        continue;
      }
      if (grab.phase === "struggle" && held.escapeProgress >= 1) {
        this.escape(grabberId, grab.heldId, grabber, held);
        continue;
      }

      grab.ticksLeft -= 1;
      if (grab.ticksLeft <= 0) {
        if (grab.phase === "limp") {
          this.letGo(grabberId, grab, grabber, held);
          continue;
        }
        // The Struggle is lost: Limp, and the grabber's own window starts.
        grab.phase = "limp";
        grab.ticksLeft = GRAB_CARRY_TICKS;
        held.forgetStruggle();
      }

      const point = grabber.carryPoint();
      // A Limp body stops being a pose and hangs as a real ragdoll from the
      // grabber's grip (`.scratch/physical-ragdoll` ticket 04) — however it
      // got there: a Struggle lost, or a body that was already down when it
      // was picked up. The capsule is still what the hold places and what a
      // swing reaches; only the look and the throw are the ragdoll's.
      if (grab.phase === "limp" && !held.isHanging) {
        held.beginLimpHang(point, GRAB_GRIP_ABOVE_CHEST, carryVelocity(grabber));
      }
      held.placeHeld(point, grabber.facing + Math.PI, carryVelocity(grabber));
      held.moveLimpHang(point);
      grabber.setGrabbingId(grab.heldId);
      held.reportHeld(grabberId, grab.phase, this.world.tick() + grab.ticksLeft);
      if (grabber.spinTicks > 0) this.swing(grabberId, grab.heldId, grabber, point);
    }

    this.updateProps(inputs, matchLocked);
    this.updateFlights();
    this.updateImmunity();
  }

  /**
   * Grab reaching for a Prop (ADR 0125): the nearest one in the same cone a
   * Character would have been caught in, light enough to lift, in play, and
   * neither carried, being Lifted, nor flying from a throw. It starts a Lift
   * (ADR 0128): the Prop stays where it lies, reserved, until the hands reach
   * it (`updateProps`) — unless it is itself flying, and is simply caught.
   *
   * Runs before the step, so the Lift's first Tick is the one being stepped.
   */
  private pickUpProp(grabberId: string, grabber: CharacterController): void {
    const props = this.world.liftableProps();
    let best: number | undefined;
    let bestDistance = Infinity;
    props.forEach((prop, index) => {
      const distance = this.reachToProp(prop, index, grabber);
      if (distance === undefined || distance >= bestDistance) return;
      best = index;
      bestDistance = distance;
    });
    if (best === undefined) return;
    const prop = props[best]!;
    const velocity = prop.velocity;
    // ADR 0128: one flying at you — a Shooter's bomb to throw back (ADR 0127),
    // one knocked flying — is caught, straight into the hold; only one lying there
    // is bent down for.
    if (velocity && lengthVec3(velocity) >= HURLED_BODY_MIN_SPEED) {
      prop.carry(grabberId, grabber.facing);
      this.propHolds.set(grabberId, { index: best, liftStartTick: null, attached: true });
      this.world.propLifted(best, grabberId);
      return;
    }
    this.propHolds.set(grabberId, { index: best, liftStartTick: this.world.tick() + 1, attached: false });
  }

  /**
   * How far `grabber`'s reach is from the Prop at `index`, or `undefined` if
   * it cannot be picked up from here: not a thing to hold, too heavy, taken,
   * flying, out of the cone or out of reach.
   */
  private reachToProp(prop: Prop, index: number, grabber: CharacterController): number | undefined {
    // A spent bomb is parked where it went off (ADR 0126): nothing to pick up.
    // A Shooter's ball is not a thing to hold; its bomb is, to throw back (ADR 0127).
    if ((prop.config.projectile === true && prop.config.bomb === undefined) || !prop.inFlight || prop.carriedBy !== null) return undefined;
    if (this.propFlights.has(index) || !canLiftProp(prop.mass)) return undefined;
    for (const hold of this.propHolds.values()) if (hold.index === index && !hold.attached) return undefined;
    const toProp = subVec3(prop.centre, grabber.position);
    toProp.y = 0;
    // Reached to its near side, not its middle: a big ball is caught by
    // the arms that touch it.
    const distance = Math.max(0, lengthVec3(toProp) - prop.horizontalRadius);
    if (distance > GRAB_RANGE) return undefined;
    if (lengthVec3(toProp) > 0 && dotVec3(forwardOf(grabber.facing), normalizeVec3(toProp)) < GRAB_FACING_COS_MIN) return undefined;
    return distance;
  }

  /**
   * Whoever carries the Prop at `index` lets go of it where it is, and it
   * stops flying if it was (ADR 0126): a bomb going off in someone's hands
   * ends the hold before the blast knocks them down.
   */
  letGoOfProp(index: number): void {
    this.propFlights.delete(index);
    for (const [carrierId, hold] of this.propHolds) {
      if (hold.index !== index) continue;
      const prop = this.world.liftableProps()[index];
      if (prop) this.endPropHold(carrierId, hold, prop, vec3());
      else this.propHolds.delete(carrierId);
    }
  }

  /**
   * Everything a carried Prop does this tick (ADR 0125), after the step:
   * dropped, put down, thrown — or carried on. And a Lift's (ADR 0128): the
   * hands reach the Prop on its touch, and the Lift is over after its last
   * Tick.
   */
  private updateProps(inputs: Record<string, SimInputs>, matchLocked: boolean): void {
    const props = this.world.liftableProps();
    for (const [carrierId, hold] of this.propHolds) {
      const prop = props[hold.index];
      const carrier = this.world.character(carrierId);
      if (!prop) {
        this.propHolds.delete(carrierId);
        continue;
      }
      if (!carrier || this.world.eliminated(carrierId)) {
        this.endPropHold(carrierId, hold, prop, vec3());
        continue;
      }
      // Knocked down, grabbed, falling off the world: it drops from the hands
      // — or, not yet reached, is never picked up.
      if (!isPlayerDrivenMotionState(carrier.motionState) || carrier.hasPendingRespawn) {
        this.endPropHold(carrierId, hold, prop, carryVelocity(carrier));
        continue;
      }
      if (hold.liftStartTick !== null) {
        const into = this.world.tick() - hold.liftStartTick;
        if (!hold.attached && into >= PROP_LIFT_CONTACT_TICKS) {
          // ADR 0128: the hands reach down to it now. Rolled out of reach
          // since the reach began, it is not picked up after all.
          hold.attached = true;
          if (this.reachToProp(prop, hold.index, carrier) === undefined) {
            this.endPropHold(carrierId, hold, prop, vec3());
            continue;
          }
          prop.carry(carrierId, carrier.facing);
          this.world.propLifted(hold.index, carrierId);
        }
        if (into >= PROP_LIFT_TICKS) hold.liftStartTick = null;
      }
      carrier.setLiftStartTick(hold.liftStartTick);
      if (!hold.attached) continue;

      const scale = propThrowScale(prop.mass);
      // ADR 0128: a Toss lets go at the end of its wind-up, from where the
      // hands are then, straight along where the carrier faces.
      if (carrier.takeToss()) {
        prop.placeCarried(this.propPoint(carrier, prop, CARRY_GRIP, PROP_TOSS_RELEASE_REACH, PROP_TOSS_RELEASE_LIFT), carrier.facing);
        const velocity = addVec3(scaleVec3(forwardOf(carrier.facing), PROP_TOSS_SPEED * scale), vec3(0, PROP_TOSS_LIFT, 0));
        this.throwProp(carrierId, hold, prop, velocity);
        continue;
      }
      const hurl = carrier.takeHurl();
      if (hurl) {
        const aim = this.world.effectiveInput(carrierId, inputs, matchLocked).moveDirection;
        const velocity = addVec3(
          scaleVec3(hurlDirection(spinTangentOf(hurl.facing), aim), (HURL_MIN_SPEED + (HURL_MAX_SPEED - HURL_MIN_SPEED) * hurl.windup) * scale),
          vec3(0, HURL_LIFT_SPEED, 0),
        );
        this.throwProp(carrierId, hold, prop, velocity);
        continue;
      }
      if (carrier.takeDizzy()) {
        const angle = this.world.roll(carrierId) * Math.PI * 2;
        const away = vec3(Math.sin(angle), 0, -Math.cos(angle));
        this.throwProp(carrierId, hold, prop, scaleVec3(away, HURL_MAX_SPEED * DIZZY_FLING_FRACTION * scale));
        carrier.knockDown("Dizzy");
        continue;
      }
      if (carrier.takeGrabRelease()) {
        this.endPropHold(carrierId, hold, prop, carryVelocity(carrier));
        continue;
      }
      // ADR 0128: a Spin holds at arm's length, once Hit has been held past a tap.
      const spun = carrier.spinTicks > PROP_TOSS_TAP_TICKS;
      const grip = spun ? SPIN_GRIP : CARRY_GRIP;
      const point = this.propPoint(carrier, prop, grip, grip.reach, grip.lift);
      prop.placeCarried(point, carrier.facing);
      carrier.setCarryingProp(hold.index);
      if (carrier.spinTicks > 0) this.swingProp(carrierId, carrier, prop, point);
    }
  }

  /**
   * Where a Prop held in `grip`'s way sits when the hands are `reach` ahead and
   * `lift` up (ADR 0128): as far from them as {@link propGripOffset} puts it
   * from the grip's own hands.
   */
  private propPoint(carrier: CharacterController, prop: Prop, grip: typeof CARRY_GRIP, reach: number, lift: number): Vec3 {
    const at = propGripOffset(prop.horizontalRadius, grip);
    return carrier.carryPoint(reach + at.forward - grip.reach, lift + at.up - grip.lift);
  }

  /** Put down or dropped (ADR 0125): a dynamic body again, keeping the carry's own velocity — or, still lying there mid-Lift, left where it is (ADR 0128). */
  private endPropHold(carrierId: string, hold: PropHold, prop: Prop, velocity: Vec3): void {
    if (hold.attached) prop.release(velocity);
    this.propHolds.delete(carrierId);
    this.world.character(carrierId)?.registerGrabReleased();
  }

  /** `id` lets go of whatever Prop it carries, where it is — it has just been grabbed itself (ADR 0125). */
  private dropProp(id: string): void {
    const hold = this.propHolds.get(id);
    const prop = hold && this.world.liftableProps()[hold.index];
    if (hold && prop) this.endPropHold(id, hold, prop, vec3());
    else this.propHolds.delete(id);
  }

  /** Tossed, Hurled or flung by a dizzy carrier (ADR 0125): let go at `velocity`, and flying. */
  private throwProp(carrierId: string, hold: PropHold, prop: Prop, velocity: Vec3): void {
    this.endPropHold(carrierId, hold, prop, velocity);
    this.propFlights.set(hold.index, { ticksLeft: HURLED_BODY_FLIGHT_TICKS, hit: new Set([carrierId]), byId: carrierId });
  }

  /**
   * A Spun Prop passing through the Characters around its carrier (ADR 0125):
   * the Shooter ball's rule at the carry point's speed, times the Prop's
   * weight — once per pass, like a swung body.
   */
  private swingProp(carrierId: string, carrier: CharacterController, prop: Prop, point: Vec3): void {
    const speed = carrySpeedAt(carrier.spinTicks, lengthVec3(subVec3(point, carrier.position)));
    const tangent = spinTangentOf(carrier.facing);
    for (const id of this.world.ids()) {
      if (id === carrierId || !this.canBeHitByBody(id)) continue;
      const other = this.world.character(id)!;
      if (!reaches(point, prop.horizontalRadius, other.position)) continue;
      const key = `${carrierId}>${id}`;
      const last = this.swingHits.get(key);
      if (last !== undefined && this.world.tick() - last < SWUNG_BODY_REHIT_TICKS) continue;
      this.swingHits.set(key, this.world.tick());
      other.applyImpact(propImpact(tangent, speed, prop.mass), "Hurl");
      this.world.credit(id, carrierId, "hit");
    }
  }

  /**
   * Whether a thrown Prop's flight may still hit `characterId`, and if so
   * counts it (ADR 0125) — the simulation asks, from the contact it found,
   * so a Prop hits whom it actually touches. Returns who threw it, to credit.
   */
  takePropFlightHit(index: number, characterId: string): string | undefined {
    const flight = this.propFlights.get(index);
    if (!flight || flight.hit.has(characterId) || !this.canBeHitByBody(characterId)) return undefined;
    flight.hit.add(characterId);
    return flight.byId;
  }

  /** Thrown Props, one tick (ADR 0125): a flight ends once it has slowed to a roll, or ran out of time. */
  private updatePropFlights(): void {
    const props = this.world.liftableProps();
    for (const [index, flight] of this.propFlights) {
      const prop = props[index];
      flight.ticksLeft -= 1;
      const velocity = prop?.velocity;
      if (!prop || !velocity || flight.ticksLeft <= 0 || Math.hypot(velocity.x, velocity.z) < HURLED_BODY_MIN_SPEED) {
        this.propFlights.delete(index);
      }
    }
  }

  /** `id` has left the Match: whatever hold it was in, in either role, ends now. */
  drop(id: string): void {
    // M6 ticket 04: a disconnect mid-hold ends it immediately rather than
    // waiting for the next `updateGrabs` pass to notice the dangling id —
    // `updateGrabs` would self-heal it regardless, but there is no reason to
    // leave a stale entry referencing a Character that no longer exists even
    // for one extra tick.
    this.holds.delete(id);
    // ADR 0125: a carrier leaving the Match lets go of what it carried.
    const carried = this.propHolds.get(id);
    const prop = carried && this.world.liftableProps()[carried.index];
    if (prop && carried.attached) prop.release(vec3());
    this.propHolds.delete(id);
    for (const flight of this.propFlights.values()) flight.hit.delete(id);
    for (const [grabberId, grab] of this.holds) {
      if (grab.heldId !== id) continue;
      // Code review: the grabber is still connected here (only the HELD
      // party just disconnected) — `GrabController.release`'s own "however
      // it ended" contract means their cooldown must still start, exactly
      // like every other release path already does. A direct `delete` here
      // with no `registerGrabReleased` call would have let them grab again
      // immediately, for free.
      this.world.character(grabberId)?.registerGrabReleased();
      this.holds.delete(grabberId);
    }
    this.immunity.delete(id);
    this.flights.delete(id);
    for (const key of [...this.swingHits.keys()]) {
      if (key.startsWith(`${id}>`) || key.endsWith(`>${id}`)) this.swingHits.delete(key);
    }
  }

  /**
   * The grabber is done with the held Character without throwing it (ADR
   * 0104): let go of, gone down, or out of Limp window. Still Struggling, it
   * is set down on its feet, Staggering; Limp, it goes into a whole knockdown.
   * Either way it keeps the carry's momentum, a Spin's included.
   */
  private letGo(grabberId: string, grab: ActiveGrab, grabber: CharacterController, held: CharacterController): void {
    const velocity = carryVelocity(grabber);
    if (grab.phase === "struggle") held.releaseOnFeet(velocity, true);
    else held.releaseKnockedDown("Grab", velocity, vec3());
    this.release(grabberId, grab.heldId);
  }

  /** The held Character won its Struggle (ADR 0104): freed on its feet, shoved clear — and flung on, if it was being Spun. */
  private escape(grabberId: string, heldId: string, grabber: CharacterController, held: CharacterController): void {
    const apart = vec3(held.position.x - grabber.position.x, 0, held.position.z - grabber.position.z);
    const away = lengthVec3(apart) > 0 ? normalizeVec3(apart) : spinTangentOf(grabber.facing);
    const shove = scaleVec3(away, GRAB_ESCAPE_SHOVE_SPEED);
    const spinning = grabber.spinTicks > 0;
    const fling = spinning
      ? scaleVec3(spinTangentOf(grabber.facing), carrySpeedAt(grabber.spinTicks) * SPIN_ESCAPE_FLING_FRACTION)
      : vec3();
    held.releaseOnFeet(addVec3(shove, fling), false);
    this.release(grabberId, heldId);
    this.world.struggleWon(heldId);
  }

  /** The held Character is thrown (ADR 0104) — a Hurl, or a dizzy grabber's weak fling: a knockdown, and a flight. */
  private hurl(grabberId: string, heldId: string, held: CharacterController, horizontal: Vec3): void {
    const launch = vec3(horizontal.x, HURL_LIFT_SPEED, horizontal.z);
    // The tumble: the same chest shove a knockdown's Impact would give, so
    // the body turns over in the air instead of flying rigid.
    held.releaseKnockedDown("Hurl", launch, scaleVec3(normalizeVec3(launch), 1));
    this.flights.set(heldId, { ticksLeft: HURLED_BODY_FLIGHT_TICKS, hit: new Set([grabberId, heldId]), byId: grabberId });
    this.release(grabberId, heldId);
    this.world.credit(heldId, grabberId, "hurled");
  }

  /** Every way a hold ends that let go of a Character still in it: the grabber's cooldown, and the held one's immunity. */
  private release(grabberId: string, heldId: string): void {
    this.end(grabberId, heldId);
    this.immunity.set(heldId, null);
  }

  /** The hold is over — whatever became of the two bodies in it. */
  private end(grabberId: string, heldId: string): void {
    this.holds.delete(grabberId);
    this.world.character(grabberId)?.registerGrabReleased();
    this.world.character(heldId)?.forgetStruggle();
  }

  /**
   * A swung body passing through the Characters around its grabber (ADR
   * 0104): each one it reaches takes an Impact scaled by how fast the carry
   * point is moving, once per pass — a full Spin knocks down, a slow one only
   * staggers.
   */
  private swing(grabberId: string, heldId: string, grabber: CharacterController, point: Vec3): void {
    const speed = carrySpeedAt(grabber.spinTicks);
    const tangent = spinTangentOf(grabber.facing);
    for (const id of this.world.ids()) {
      if (id === grabberId || id === heldId || !this.canBeHitByBody(id)) continue;
      const other = this.world.character(id)!;
      if (!within(point, other.position)) continue;
      const key = `${grabberId}>${id}`;
      const last = this.swingHits.get(key);
      if (last !== undefined && this.world.tick() - last < SWUNG_BODY_REHIT_TICKS) continue;
      this.swingHits.set(key, this.world.tick());
      other.applyImpact(bodyImpact(tangent, speed), "Hurl");
      this.world.credit(id, grabberId, "hit");
    }
  }

  /** Hurled bodies still in the air hitting whoever they reach (ADR 0104) — each Character once per flight. */
  private updateFlights(): void {
    this.updatePropFlights();
    for (const [bodyId, flight] of this.flights) {
      const body = this.world.character(bodyId);
      flight.ticksLeft -= 1;
      if (!body || this.world.eliminated(bodyId) || body.motionState !== "Ragdoll" || flight.ticksLeft <= 0) {
        this.flights.delete(bodyId);
        continue;
      }
      const velocity = body.bodyVelocity;
      const speed = Math.hypot(velocity.x, velocity.z);
      if (speed < HURLED_BODY_MIN_SPEED) {
        this.flights.delete(bodyId);
        continue;
      }
      for (const id of this.world.ids()) {
        if (flight.hit.has(id) || !this.canBeHitByBody(id)) continue;
        const other = this.world.character(id)!;
        if (!within(body.position, other.position)) continue;
        flight.hit.add(id);
        other.applyImpact(bodyImpact(vec3(velocity.x, 0, velocity.z), speed), "Hurl");
        this.world.credit(id, flight.byId, "hit");
      }
    }
    for (const key of [...this.swingHits.keys()]) {
      if (this.world.tick() - this.swingHits.get(key)! >= SWUNG_BODY_REHIT_TICKS) this.swingHits.delete(key);
    }
  }

  /** Whether a swung or hurled body can land on `id`: in the Round, on its feet, and in no hold of its own. */
  private canBeHitByBody(id: string): boolean {
    const character = this.world.character(id);
    return (
      character !== undefined &&
      !this.world.eliminated(id) &&
      isPlayerDrivenMotionState(character.motionState) &&
      !this.inCharacterHold(id)
    );
  }

  /** Grab immunity, one tick (ADR 0104): it starts counting once the Character is standing again, and lapses after `GRAB_IMMUNITY_TICKS`. */
  private updateImmunity(): void {
    for (const [id, left] of this.immunity) {
      const character = this.world.character(id);
      if (!character || this.world.eliminated(id)) {
        this.immunity.delete(id);
      } else if (left === null) {
        if (character.motionState === "Controlled") this.immunity.set(id, GRAB_IMMUNITY_TICKS);
      } else if (left <= 1) {
        this.immunity.delete(id);
      } else {
        this.immunity.set(id, left - 1);
      }
    }
  }
}

/** How fast the carry point is moving (ADR 0104): the grabber's own walk, plus a Spin's speed around it. */
const carryVelocity = (grabber: CharacterController): Vec3 => {
  const walking = grabber.currentVelocity;
  if (grabber.spinTicks === 0) return walking;
  return addVec3(walking, scaleVec3(spinTangentOf(grabber.facing), carrySpeedAt(grabber.spinTicks)));
};

/**
 * Which way a Hurl leaves (ADR 0104): along the circle's `tangent` at the
 * moment of release, turned onto `aim` — the direction the grabber is
 * steering — when the two are within `HURL_AIM_SNAP_DEG` of each other.
 */
/**
 * How fast a Hurl throws (`.scratch/physical-ragdoll` ticket 04, settled with
 * the user 2026-09-20): the speed the Spin *really* gave the hanging body,
 * clamped into the band ADR 0104 measured against the Hit's own reach. The
 * look is the physics'; the balance stays the one that was played.
 *
 * A body that is not hanging — released during its Struggle, or on a client
 * whose prediction never saw the hold — has no real speed to read, so it
 * falls back to the wind-up's own place in that band.
 */
export const hurlSpeed = (held: CharacterController, windup: number): number => {
  const measured = held.isHanging ? Math.hypot(held.hangVelocity().x, held.hangVelocity().z) : null;
  const speed = measured ?? HURL_MIN_SPEED + (HURL_MAX_SPEED - HURL_MIN_SPEED) * windup;
  return Math.min(HURL_MAX_SPEED, Math.max(HURL_MIN_SPEED, speed));
};

export const hurlDirection = (tangent: Vec3, aim: Vec3): Vec3 => {
  if (lengthVec3(aim) === 0) return tangent;
  const steer = normalizeVec3(vec3(aim.x, 0, aim.z));
  return dotVec3(tangent, steer) >= HURL_AIM_SNAP_COS ? steer : tangent;
};

/** Whether a body at `body` reaches a Character standing at `at`: horizontally within reach, and at the height of its capsule. */
const within = (body: Vec3, at: Vec3): boolean => {
  const apart = subVec3(at, body);
  return Math.hypot(apart.x, apart.z) <= SWUNG_BODY_REACH && Math.abs(apart.y) <= 2 * CAPSULE_HALF_HEIGHT;
};

/** The Impact a body moving along `direction` at `speed` lands on whoever it hits — the Bump's shape, with a lift. */
const bodyImpact = (direction: Vec3, speed: number): Vec3 => {
  const away = normalizeVec3(vec3(direction.x, 0, direction.z));
  return scaleVec3(normalizeVec3(vec3(away.x, SWUNG_BODY_LIFT_RATIO, away.z)), speed * SWUNG_BODY_IMPACT_SCALE);
};

/** Whether a swung Prop at `centre`, reaching `radius` across the ground, touches a Character standing at `at`. */
const reaches = (centre: Vec3, radius: number, at: Vec3): boolean => {
  const apart = subVec3(at, centre);
  return Math.hypot(apart.x, apart.z) <= radius + CAPSULE_RADIUS && Math.abs(apart.y) <= 2 * CAPSULE_HALF_HEIGHT;
};

/**
 * The Impact a Prop of `mass` moving along `direction` at `speed` deals (ADR
 * 0125): the Shooter ball's rule — the Moving Segment mapping of a closing
 * speed — times its weight against the ball's, so a Prop as heavy as a
 * Shooter's ball hits exactly like one.
 */
export const propImpact = (direction: Vec3, speed: number, mass: number): Vec3 => {
  const away = normalizeVec3(vec3(direction.x, 0, direction.z));
  const magnitude = movingSegmentImpactMagnitude(speed) * (mass / PROJECTILE_MASS);
  return scaleVec3(normalizeVec3(vec3(away.x, MOVING_SEGMENT_LIFT_RATIO, away.z)), magnitude);
};
