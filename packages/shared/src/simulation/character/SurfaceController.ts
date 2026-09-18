import RAPIER from "@dimforge/rapier3d-compat";
import { vec3, type Vec3 } from "../../math/vec3.js";
import {
  CAPSULE_HALF_HEIGHT,
  CAPSULE_RADIUS,
  CHARACTER_CONTROLLER_OFFSET,
  GROUND_SNAP_DISTANCE,
  SURFACE_GROUND_NORMAL_MIN_Y,
  WALL_NORMAL_MAX_Y,
} from "../../tuning/character.js";
import { TICK_DT } from "../../tuning/clock.js";
import { WALL_IMPACT_MIN_SPEED } from "../../tuning/knockdown.js";
import { WALKABLE_SLOPE_MAX_ANGLE } from "../../tuning/movement.js";
import { SLIP_IMPULSE } from "../../tuning/surfaces.js";
import type {
  SurfaceBounceConfig,
  SurfaceConfig,
  SurfaceCrashKnockdownConfig,
  SurfaceLandingKnockdownConfig,
  SurfaceRunningSlipConfig,
} from "../../track/Surface.js";
import { CHARACTER_GROUPS, GROUP_CHARACTER } from "../collisionGroups.js";
import type { Capsule } from "./Capsule.js";

/** A ground normal's Y component below this is steeper than {@link WALKABLE_SLOPE_MAX_ANGLE} — the walkable/Sliding boundary, ticket 03. */
export const WALKABLE_NORMAL_MIN_Y = Math.cos(WALKABLE_SLOPE_MAX_ANGLE);

const DOWN = vec3(0, -1, 0);

/** Where `walkableUnderfoot` casts from, around the capsule's axis (ADR 0084): the centre and a radius out along each axis. */
const FOOTPRINT_PROBE_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [CAPSULE_RADIUS, 0],
  [-CAPSULE_RADIUS, 0],
  [0, CAPSULE_RADIUS],
  [0, -CAPSULE_RADIUS],
];

/** A ground query's filter: another Character is never the floor. */
const isNotCharacter = (collider: RAPIER.Collider): boolean =>
  ((collider.collisionGroups() >>> 16) & GROUP_CHARACTER) === 0;

/**
 * The world under a Character for one tick (ADR 0036, 2026-09 audit §1.2),
 * handed over by `RapierSimulation` — the one caller that knows the ground
 * collider, the Volumes, this Character's id and the Tick.
 *
 * Resolved from the ground contact of the tick *before*, which is the same
 * one-tick lag `grounded` itself has relative to jump and landing.
 */
export interface GroundContext {
  /** The Surface of whatever is underfoot — its speed, grip, bounce, take-off and landing hazard in one record. */
  surface: SurfaceConfig;
  /** The belt that ground runs, if any (ADR 0064). Still floor, or mid-air, is no belt at all. */
  conveyor: Vec3 | undefined;
  /** The Volume containing this Character, if any (M3.7 ticket 04) — highest priority wins outright, never summed. */
  volume: { force: Vec3; maxInducedSpeed: number } | undefined;
  /**
   * This `(Character, Tick)`'s slip draw in `[0, 1)` (ADR 0092) — the one
   * number every Surface hazard that is a chance reads this tick (a landing,
   * a run, a turn: ADR 0102). Drawn by the caller because that is what knows
   * both, and deterministic because a `Math.random()` coin flip would make
   * every slip a mispredicted correction.
   */
  slipRoll: number;
}

/** The floor a sweep found under the Character this tick — see `adoptGroundContact`. */
export interface GroundContact {
  handle: number;
  normal: Vec3;
}

/**
 * What is under a Character's feet (ADR 0036): the Surface it stands on and
 * everything that Surface does to it, the belt and the Volume it is in, and
 * the ground contact the capsule's own sweep found. The one place a new
 * Surface property — or a new hazard a Surface can have — is read.
 *
 * Every field is written here and only read elsewhere in `CharacterController`.
 */
export class SurfaceController {
  /**
   * The floor collider this tick's ground contact was against, if any
   * (ticket 01/ADR 0036) — the "floor collider the character controller
   * already reports" `RapierSimulation` resolves a Surface from, without a
   * new scene query. Set in {@link adoptGroundContact} from this tick's own
   * `computeColliderMovement` collisions (the same list the dash-into-wall
   * check already walks), never from a separate raycast. `undefined`
   * whenever not grounded, so `RapierSimulation` reads the default Surface
   * in the air exactly like it would with no ground contact at all.
   */
  currentGroundColliderHandle: number | undefined;
  /**
   * This tick's ground-contact surface normal, if any (ticket 03, M3.6) —
   * what decides `tooSteepToWalk` (below) and, while `Sliding`, the
   * direction gravity is projected along. Updated in {@link adoptGroundContact}
   * with exactly the same "only update on a fresh hit, clear only once
   * ungrounded" stickiness as {@link currentGroundColliderHandle}, for the
   * same reason (code review, ticket 02): Rapier's own snap-to-ground can
   * make `computedGrounded()` true via a correction that never appears in
   * `computedCollision()`'s list, and this is exactly the steep/fast-descent
   * case that happens on.
   */
  currentGroundNormal: Vec3 | undefined;
  /**
   * Multiplies `WALK_SPEED` this tick (ticket 01) — set from outside by
   * `RapierSimulation` once it's resolved `groundColliderHandle`
   * against the Track's Surfaces, one tick behind (the same lag `grounded`
   * itself already has relative to `RapierSimulation`'s per-tick bookkeeping).
   * 1 (no effect) until anything ever calls {@link apply}.
   */
  surfaceTopSpeedMultiplier = 1;
  /**
   * Multiplies both `MOVE_ACCEL_FACTOR` and `MOVE_FRICTION_FACTOR` this tick
   * (ticket 06) — set from outside by `RapierSimulation` alongside
   * {@link surfaceTopSpeedMultiplier}, from the same resolved Surface, with
   * the same one-tick lag. 1 (full grip, today's saturating default) until
   * anything ever calls {@link apply}.
   */
  surfaceGrip = 1;
  /** The floor underfoot refuses a Dash (`SurfaceConfig.noDash`: ice, mud, bounce). */
  surfaceNoDash = false;
  /**
   * This tick's belt flow, if the ground collider runs one (ADR 0064) — set
   * from outside by `RapierSimulation` alongside {@link surfaceGrip}, from
   * the same resolved ground contact, with the same one-tick lag. Joins the
   * wish velocity `walk` outright (ADR 0035's "one contributor" model):
   * grip, slope scaling and the Sliding steer blend all apply to it for
   * free, and stepping off the belt ends it the same tick. Zero (still
   * floor, or mid-air) until anything ever calls {@link apply}.
   */
  conveyorVelocity: Vec3 = { x: 0, y: 0, z: 0 };
  /**
   * This tick's Surface-driven bounce config, if any (M3.7 ticket 02) — set
   * from outside by `RapierSimulation` alongside {@link surfaceTopSpeedMultiplier}/
   * {@link surfaceGrip}, from the same resolved Surface, with the same
   * one-tick lag. `undefined` (no bounce, the ordinary ground-stick clamp)
   * until anything ever calls {@link apply}.
   */
  surfaceBounce: SurfaceBounceConfig | undefined;
  /**
   * This tick's Surface-driven take-off multiplier (ADR 0092) — pushed from
   * outside with the same one-tick lag as {@link surfaceBounce}, which is
   * exactly right here: the Surface that decides how well you push off is
   * the one you were standing on going into the jump.
   */
  surfaceJumpMultiplier = 1;
  /**
   * This tick's Surface-driven landing hazard, if any (ADR 0092) — ice.
   * Pushed and lagged like {@link surfaceBounce}, and read in the same
   * landing branch against the same `airbornePeakFallSpeed`, so it
   * resolves on the tick the ground contact does.
   */
  surfaceLandingKnockdown: SurfaceLandingKnockdownConfig | undefined;
  /**
   * This tick's crash rule, if the Surface has its own (ADR 0102) — ice,
   * where running into anything, another Character included, takes your
   * feet. Pushed and lagged like {@link surfaceBounce}; read by
   * {@link crashMinSpeed}.
   */
  surfaceCrashKnockdown: SurfaceCrashKnockdownConfig | undefined;
  /**
   * This tick's running hazard, if any (ADR 0102) — mud. Pushed and lagged
   * like {@link surfaceBounce}; read by {@link runningImpact}.
   */
  surfaceRunningSlip: SurfaceRunningSlipConfig | undefined;
  /**
   * This tick's slip draw in `[0, 1)` (ADR 0092) — `slipRoll(id, tick)`,
   * computed by `RapierSimulation`, which is what knows both. Pushed rather
   * than drawn here so this class needs neither its own id nor the tick
   * counter, and so the one place that decides "what is a deterministic
   * draw" stays one place. Every hazard that is a chance reads it (ADR
   * 0102); two that fire on the same tick are still one slip, since only the
   * strongest queued Impact counts.
   */
  slipRoll = 1;
  /**
   * This tick's active Volume, if any (M3.7 ticket 04, ADR 0036) — set from
   * outside by `RapierSimulation`, resolved from the Character's position
   * with the same one-tick lag `surfaceBounce`/`surfaceGrip` themselves have
   * (containment is checked *after* this tick's own move, for next tick's
   * force). `undefined` (no Volume contains this Character) most of the
   * time, until anything ever calls {@link apply}. Deliberately
   * just `{ force, maxInducedSpeed }`, not the full `VolumeConfig` — this
   * Character never needs to know its own `bounds`/`priority` back.
   */
  activeVolume: { force: Vec3; maxInducedSpeed: number } | undefined;

  constructor(private readonly capsule: Capsule) {}

  /**
   * Everything the world under this Character says about the coming tick, in
   * one call (2026-09 audit §1.2).
   *
   * There were eight setters here, which `RapierSimulation` had to call in
   * order, every tick, for every Character, before `endTick` meant anything —
   * temporal coupling written out longhand, and it grew by one setter, one
   * field and one line per Surface property ever added. A Surface property now
   * costs a field in `SURFACES` and a read below.
   *
   * Every field is *this tick's*, resolved from the ground contact one tick
   * ago (ADR 0036) — the same one-tick lag `grounded` itself has relative to
   * jump and landing, and the reason it is pushed in rather than read out.
   *
   * `grounded` (ADR 0094 amendment, found live 2026-09-18): the movement
   * model's pair — the top-speed cap and the grip — carries through the air
   * off the Surface it took off from, until the next ground contact adopts
   * that floor's own. Mid-air the resolved Surface is always the default
   * (no ground handle), and adopting its 1/1 every airborne tick meant a
   * Character HOPPING across mud or ice ran at full speed and full grip for
   * every tick it was off the ground — most of the crossing, jumped. Every
   * positional field below still resets in the air as before: a belt, a
   * hazard and a bounce need the floor; a Volume applies wherever the
   * Character is.
   */
  apply(ground: GroundContext, grounded: boolean): void {
    // A Dash only ever starts grounded, so the floor underfoot is the one that decides.
    this.surfaceNoDash = ground.surface.noDash === true;
    if (grounded) {
      this.surfaceTopSpeedMultiplier = ground.surface.topSpeedMultiplier;
      this.surfaceGrip = ground.surface.grip;
    }
    this.surfaceBounce = ground.surface.bounce;
    // ADR 0092: the same resolved Surface decides the jump it gives back and
    // the landing it may not let you keep.
    this.surfaceJumpMultiplier = ground.surface.jumpMultiplier ?? 1;
    this.surfaceLandingKnockdown = ground.surface.landingKnockdown;
    // ADR 0102: and what it does to a Character running into something, or
    // running on it at all.
    this.surfaceCrashKnockdown = ground.surface.crashKnockdown;
    this.surfaceRunningSlip = ground.surface.runningSlip;
    this.slipRoll = ground.slipRoll;
    // ADR 0064: still floor (or mid-air) reads as no belt at all.
    this.conveyorVelocity = ground.conveyor ?? { x: 0, y: 0, z: 0 };
    this.activeVolume = ground.volume;
  }

  /**
   * Ticket 03, M3.6: last tick's ground contact (from `resolveCollisions`,
   * read here before this tick's own sweep overwrites it) decides whether
   * this tick enters/stays in `Sliding` — the same one-tick lag `grounded`
   * itself already has relative to jump/landing. `currentGroundNormal` is
   * `undefined` both while airborne and while grounded on a Surface flat
   * enough to be filtered out by `SURFACE_GROUND_NORMAL_MIN_Y`, so both
   * correctly read as "not too steep" here. A steep contact alone is not
   * enough (ADR 0084): the ground under the footprint has to agree, so the
   * rounded bottom of the capsule brushing a step's edge or chamfer doesn't
   * read as a slope.
   */
  tooSteepToWalk(grounded: boolean): boolean {
    return (
      grounded &&
      this.currentGroundNormal !== undefined &&
      this.currentGroundNormal.y < WALKABLE_NORMAL_MIN_Y &&
      !this.walkableUnderfoot()
    );
  }

  /**
   * Whether any of five downward rays under the capsule — its centre and four
   * points a radius out — lands on walkable ground within
   * {@link GROUND_SNAP_DISTANCE} of its feet (ADR 0084). On a real slope every
   * ray lands on the slope. Against a step's edge or chamfer, which the
   * capsule's rounded bottom touches at 45–60° while it still stands on the
   * deck, at least one lands on the deck: a chamfer on these Assets is
   * narrower than the ring is wide. Only asked when the contact is already
   * too steep, so a Character on flat ground casts nothing.
   */
  private walkableUnderfoot(): boolean {
    const at = this.capsule.body.translation();
    const originY = at.y - CAPSULE_HALF_HEIGHT; // the bottom sphere's centre
    for (const [dx, dz] of FOOTPRINT_PROBE_OFFSETS) {
      const hit = this.capsule.world.castRayAndGetNormal(
        new RAPIER.Ray({ x: at.x + dx, y: originY, z: at.z + dz }, DOWN),
        CAPSULE_RADIUS + GROUND_SNAP_DISTANCE,
        true,
        undefined,
        CHARACTER_GROUPS,
        this.capsule.collider,
        undefined,
        isNotCharacter,
      );
      if (hit && hit.normal.y >= WALKABLE_NORMAL_MIN_Y) return true;
    }
    return false;
  }

  /**
   * How far below the capsule, once moved by `movement`, standable ground
   * lies — within {@link GROUND_SNAP_DISTANCE}, or `undefined` (ADR 0084).
   * The same cast Rapier's own snap-to-ground makes, for the one case it
   * skips: a sweep that ended higher than it started.
   */
  standableGroundBelow(movement: Vec3): number | undefined {
    const at = this.capsule.body.translation();
    const hit = this.capsule.world.castShape(
      { x: at.x + movement.x, y: at.y + movement.y, z: at.z + movement.z },
      this.capsule.body.rotation(),
      DOWN,
      this.capsule.collider.shape,
      CHARACTER_CONTROLLER_OFFSET,
      GROUND_SNAP_DISTANCE,
      false,
      undefined,
      CHARACTER_GROUPS,
      this.capsule.collider,
      undefined,
      isNotCharacter,
    );
    return hit && hit.normal1.y > WALL_NORMAL_MAX_Y ? hit.time_of_impact : undefined;
  }

  /**
   * The most floor-like collision so far this tick — highest `normal.y` among
   * the roughly-horizontal ones. This is the ground contact ticket 01/ADR 0036
   * reads a Surface from, and `GROUND_STICK_SPEED` is exactly what makes it
   * show up reliably every grounded tick: it is the reason a resting Character
   * keeps sweeping into the floor at all.
   */
  betterGroundContact(best: GroundContact | undefined, handle: number, normal: Vec3): GroundContact | undefined {
    if (normal.y <= SURFACE_GROUND_NORMAL_MIN_Y) return best;
    if (best !== undefined && normal.y <= best.normal.y) return best;
    return { handle, normal };
  }

  /**
   * Take this tick's ground contact, or keep the last one.
   *
   * Ticket 02 code review: Rapier's own snap-to-ground can make
   * `computedGrounded()` true through an internal correction that never
   * appears in `computedCollision()`'s list at all — exactly on the
   * steep/fast-descent ticks snap-to-ground exists for, since those are the
   * ones the regular sweep alone does not keep contact on. Clearing the handle
   * then would silently drop the Surface (mud/ice) back to default for as long
   * as that persists, which was confirmed empirically to last many consecutive
   * ticks. So the handle is only ever *updated* when this tick's sweep
   * actually found a qualifying collision, and only ever cleared once
   * `grounded` itself goes false. Worst case it is one tick stale right at a
   * Surface boundary — the same order of lag this whole pipeline already has.
   */
  adoptGroundContact(grounded: boolean, found: GroundContact | undefined): void {
    if (!grounded) {
      this.currentGroundColliderHandle = undefined;
      this.currentGroundNormal = undefined;
    } else if (found !== undefined) {
      this.currentGroundColliderHandle = found.handle;
      this.currentGroundNormal = found.normal;
    }
  }

  /**
   * No ground sweep runs while ragdolling — leaving the last-known handle
   * in place could hand RapierSimulation a stale Surface (e.g. still
   * "mud" from before the knockdown) the instant it gets back up
   * somewhere else entirely. The next real `beginCapsuleTick` recomputes
   * this fresh from an actual sweep.
   */
  leaveGround(): void {
    this.currentGroundColliderHandle = undefined;
    this.currentGroundNormal = undefined;
  }

  /**
   * A landing on a slippery Surface that may take the Character's feet out
   * from under it (ADR 0092) — ice's own hazard, mud's (ADR 0102), and any
   * Surface's that declares a `landingKnockdown`. Returns the Impact to
   * apply, or `undefined` on every Surface without one, below its speed, and
   * on the draw that comes up safe.
   */
  landingImpact(velocity: Vec3, airbornePeakFallSpeed: number): Vec3 | undefined {
    const knockdown = this.surfaceLandingKnockdown;
    if (!knockdown) return undefined;
    if (airbornePeakFallSpeed < knockdown.minSpeed) return undefined;
    if (this.slipRoll >= knockdown.chance) return undefined;
    return this.slipImpulse(velocity);
  }

  /**
   * Running on a Surface that may take the Character's feet (ADR 0102) —
   * mud's own hazard, and any Surface's that declares a `runningSlip`.
   * `before` is the velocity the Character brought into this tick and `after`
   * what its own movement made of it, before anything rides on top (a shove,
   * a launch, a Volume). The belt underfoot is taken out of both, so what is
   * judged is the Character's feet against the floor.
   *
   * A turn sharper than `turnMinAngle` from one to the other, both at or
   * above `minSpeed`, is a draw at `turnChance`; merely running at or above
   * `minSpeed` is a draw at this tick's share of `chancePerSecond`. The turn
   * outranks the run rather than adding to it — the two ask one question.
   *
   * On a turn the sprawl goes along the old heading: the momentum the turn
   * lost the race with. Otherwise it goes the way the Character is running.
   */
  runningImpact(before: Vec3, after: Vec3): Vec3 | undefined {
    const slip = this.surfaceRunningSlip;
    if (!slip) return undefined;
    const belt = this.conveyorVelocity;
    const from = vec3(before.x - belt.x, 0, before.z - belt.z);
    const to = vec3(after.x - belt.x, 0, after.z - belt.z);
    const toSpeed = Math.hypot(to.x, to.z);
    if (toSpeed < slip.minSpeed) return undefined;
    const fromSpeed = Math.hypot(from.x, from.z);
    const turned =
      fromSpeed >= slip.minSpeed &&
      from.x * to.x + from.z * to.z < Math.cos(slip.turnMinAngle) * fromSpeed * toSpeed;
    const chance = turned ? slip.turnChance : 1 - (1 - slip.chancePerSecond) ** TICK_DT;
    if (this.slipRoll >= chance) return undefined;
    return this.slipImpulse(turned ? from : to);
  }

  /**
   * The Impact a slip applies: {@link SLIP_IMPULSE}, horizontal, the way
   * `heading` goes — so a slip reads as losing a race with your own
   * momentum. With no horizontal speed to inherit — a drop straight down onto
   * ice — the direction comes off the same draw that decided the slip, which
   * keeps it deterministic (and so predictable by the client) without
   * inventing a second source of chance.
   */
  private slipImpulse(heading: Vec3): Vec3 {
    const horizontal = Math.hypot(heading.x, heading.z);
    const dir =
      horizontal > 0.5
        ? { x: heading.x / horizontal, z: heading.z / horizontal }
        : { x: Math.cos(this.slipRoll * Math.PI * 2), z: Math.sin(this.slipRoll * Math.PI * 2) };
    return vec3(dir.x * SLIP_IMPULSE, 0, dir.z * SLIP_IMPULSE);
  }

  /**
   * The closing speed at which running into something knocks this Character
   * down (M3.7 ticket 03, ADR 0037), or `undefined` where running into it
   * cannot. Asked here, of the ground under the Character, rather than read
   * as a constant where the crash is resolved, so a Surface that takes your
   * feet at any speed is a change to what this answers.
   *
   * {@link WALL_IMPACT_MIN_SPEED} on every Surface without a crash rule of its
   * own, where another Character never counts: a Bump is one-sided (M2
   * ticket 04), only the one bumped goes down. On a Surface with one — ice,
   * ADR 0102 — anything counts, another Character included, from its own
   * much lower speed.
   */
  crashMinSpeed(intoCharacter: boolean): number | undefined {
    if (this.surfaceCrashKnockdown) return this.surfaceCrashKnockdown.minSpeed;
    return intoCharacter ? undefined : WALL_IMPACT_MIN_SPEED;
  }

  /**
   * Reconciliation's fallback (ADR 0036): the snapshot carries no Surface,
   * Volume or ground normal of its own — each is a pure function of position,
   * never replicated — so the replay starts from the safest reading and the
   * very next real sweep and containment check recompute the true ones.
   * `sliding` keeps a restored `Sliding` from being flipped straight back to
   * Controlled (see `CharacterController.reconcileTo`).
   */
  reconcile(sliding: boolean): void {
    // The correction can move the capsule across a Surface boundary (mud/ice
    // vs default) that a mispredicting client had no way to see coming — the
    // snapshot carries no Surface of its own (ADR 0036: it's a pure function
    // of position, never replicated), so the safest thing this can do is
    // fall back to full grip / no cap and let the very next real ground
    // sweep recompute the true Surface, exactly like the existing one-tick
    // lag already does after a normal landing. Without this the first tick
    // replayed from here
    // would run with whatever multiplier happened to be set before the
    // correction (code review, ticket 01) — a *second*, undocumented tick of
    // wrong walk speed stacked on top of the position correction itself.
    this.currentGroundColliderHandle = undefined;
    // Code review, ticket 03: a snapshot's `motionState` is authoritative for
    // *state* but carries no ground normal of its own (never replicated —
    // it's a pure function of position, ADR 0036/0037). Clearing this to
    // `undefined` unconditionally (as the Surface handle above still
    // correctly does) would break reconciling into "Sliding" specifically:
    // `beginTick`'s `tooSteepToWalk` reads this field *before* this same
    // tick's own sweep can refresh it, so it would read `false` and the
    // state machine would immediately flip the just-restored Sliding back to
    // Controlled for one tick — discarding the server's own conclusion. A
    // synthetic near-vertical normal (just past the walkable threshold) is
    // enough to keep the *state* correct for that one tick; projected onto a
    // vertical normal, its own tangential-gravity contribution is ~0, so the
    // Character simply doesn't accelerate for that one tick instead of
    // wrongly regaining full control — a much smaller, self-correcting
    // discrepancy, fixed for real the moment the next sweep runs.
    this.currentGroundNormal = sliding ? { x: 0, y: WALKABLE_NORMAL_MIN_Y - 0.01, z: 0 } : undefined;
    this.surfaceTopSpeedMultiplier = 1;
    this.surfaceGrip = 1;
    this.surfaceNoDash = false;
    this.surfaceBounce = undefined;
    // ADR 0102: nor may the replay's first tick take the Character's feet on
    // a Surface it may no longer be on — the safest reading is the default
    // Surface's, which has no hazard at all.
    this.surfaceCrashKnockdown = undefined;
    this.surfaceRunningSlip = undefined;
    // Same reasoning, same ADR 0036 "pure function of position" — a Volume
    // isn't in the snapshot either, so the safest fallback is "not in one"
    // until the very next real containment check (below, same tick's own
    // sweep already refreshed the ground handle by then) recomputes it.
    this.activeVolume = undefined;
  }
}
