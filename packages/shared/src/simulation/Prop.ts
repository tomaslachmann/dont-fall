import RAPIER from "@dimforge/rapier3d-compat";
import { conjugateQuat, IDENTITY_QUAT, mulQuat, type Quat } from "../math/quat.js";
import { addVec3, lengthVec3, rotateVec3ByQuat, scaleVec3, subVec3, vec3, type Vec3 } from "../math/vec3.js";
import { PROP_PUSH_SCALE } from "../tuning/world.js";
import type { SolidShape } from "../track/asset.js";
import type { BombDef } from "../track/Bomb.js";
import type { SegmentColorId } from "../track/SegmentColor.js";
import { PROP_GROUPS } from "./collisionGroups.js";
import { solidColliderDesc } from "./MovingSegment.js";

/** One authored solid part of an Asset Prop, already scaled, in the Asset's own frame (ADR 0065/0095). */
export interface PropSolidPart {
  shape: SolidShape;
  position: Vec3;
  rotation: Quat;
}

export type PropShape =
  | { kind: "box"; halfExtents: Vec3 }
  | { kind: "ball"; radius: number }
  /**
   * An Asset Prop (ADR 0095): a placed Asset a Character can shove around,
   * colliding as the authored solid parts a Moving Segment collides as — and
   * for the same reason (a hollow trimesh on a body that moves traps whatever
   * ends up inside it). `moduleId`/`scale`/`color` are what the renderer draws
   * it with; nothing in the simulation reads them.
   */
  | { kind: "asset"; moduleId: string; scale: number; parts: PropSolidPart[]; color?: SegmentColorId };

export interface PropConfig {
  shape: PropShape;
  /**
   * Starting position. The body centre for a box or a ball; for an Asset
   * Prop it is the Segment's own origin — the Asset pivot its parts are
   * measured from — so the body starts exactly where the Track placed it.
   */
  center: Vec3;
  /** Starting orientation, identity when absent — how an Asset Prop keeps the yaw/pitch/roll it was placed with. */
  rotation?: Quat;
  mass?: number;
  friction?: number;
  /**
   * This Prop is a Shooter's ball (CONTEXT.md: Projectile, ADR 0119): it
   * starts parked — colliders off, drawn by nobody — and is fired and taken
   * away by its Shooter rather than standing in the world.
   */
  projectile?: boolean;
  /**
   * This Prop is a Bomb (CONTEXT.md: Bomb, ADR 0126): picking it up lights
   * it, and once spent it is parked — colliders off, drawn only by its own
   * explosion — until it is put back at {@link center}.
   */
  bomb?: BombDef;
}

export interface PropSnapshot {
  position: Vec3;
  rotation: Quat;
  /**
   * Linear velocity (units/s). Present only when `atRest` is false — a
   * re-simulating client needs it to converge instead of replaying from a
   * standstill every snapshot (ADR 0022). `{0,0,0}` when omitted.
   */
  velocity?: Vec3;
  /** Angular velocity (rad/s). Same rule as {@link velocity}. */
  angularVelocity?: Vec3;
  /** The Rapier body is sleeping — it has come to rest (ADR 0022). */
  atRest: boolean;
  /**
   * A Projectile is in flight (ADR 0119). Absent on every ordinary Prop,
   * which is always there; `false` is a ball waiting in its Shooter, drawn by
   * nobody and interpolated by nobody — the flag flipping is a teleport, not
   * a journey.
   */
  live?: boolean;
  /** Who is carrying it (ADR 0125). Absent while nobody is. */
  carriedBy?: string;
}

const DEFAULT_MASS = 4;
const DEFAULT_FRICTION = 0.6;
const ZERO = { x: 0, y: 0, z: 0 };

/**
 * A dynamic physics prop (box or ball) the Character can bump and knock around
 * (ticket 06). Motion is ordinary Rapier dynamics — `RapierSimulation` only
 * shoves it via {@link shove} when the Character's movement collides with it.
 */
export class Prop {
  readonly config: PropConfig;
  /**
   * Every collider on this body — one for a box or a ball, one per authored
   * solid part for an Asset Prop. `RapierSimulation` maps each handle back to
   * the Prop, so a shove landing on any part of an Asset moves the whole thing.
   */
  readonly colliders: RAPIER.Collider[];
  private readonly body: RAPIER.RigidBody;
  /** Whether its colliders are on: always, but for a Projectile waiting in its Shooter (ADR 0119). */
  private live = true;
  /**
   * Who is carrying it, or `null` (ADR 0125). A carried Prop is kinematic with
   * its colliders off, posed by its carrier every Tick. On a client it is only
   * ever what the latest snapshot said.
   */
  private carrier: string | null = null;
  /** The rotation it is held at, relative to its carrier's facing — so it turns with its carrier. */
  private carriedTurn: Quat = IDENTITY_QUAT;
  /** The middle of its solid parts, in its own frame — what a carry puts at the carry point. */
  readonly localCentre: Vec3;
  /** How far it reaches from {@link localCentre} across the ground (units): what keeps a carried ball out of its carrier. */
  readonly horizontalRadius: number;
  /** How far it reaches from {@link localCentre} in any direction (units): what a Shooter clears its barrel by (ADR 0127). */
  readonly radius: number;
  /** Its mass — what the weight of a carry and the momentum of a throw are read from (ADR 0125). */
  readonly mass: number;

  constructor(world: RAPIER.World, config: PropConfig) {
    this.config = config;
    const rotation = config.rotation ?? IDENTITY_QUAT;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(config.center.x, config.center.y, config.center.z)
        .setRotation(rotation)
        // A Projectile moves further in a Tick than it is wide (ADR 0119): at
        // 18 u/s a 0.5 m ball covers 0.6 m, so without continuous collision it
        // steps straight through a Character — measured, before this line.
        .setCcdEnabled(config.projectile === true),
    );
    const friction = config.friction ?? DEFAULT_FRICTION;
    const descs: RAPIER.ColliderDesc[] =
      config.shape.kind === "asset"
        ? config.shape.parts.flatMap((part) => {
            const desc = solidColliderDesc(part.shape);
            return desc === null ? [] : [desc.setTranslation(part.position.x, part.position.y, part.position.z).setRotation(part.rotation)];
          })
        : config.shape.kind === "box"
          ? [RAPIER.ColliderDesc.cuboid(config.shape.halfExtents.x, config.shape.halfExtents.y, config.shape.halfExtents.z)]
          : [RAPIER.ColliderDesc.ball(config.shape.radius)];
    if (descs.length === 0) {
      // An Asset whose solid parts all came out degenerate: keep a body rather
      // than a hole in the Track, sized from nothing so it simply falls away.
      descs.push(RAPIER.ColliderDesc.ball(0.1));
    }
    // The mass is the Prop's, not each part's — split evenly, so an Asset
    // built from five hulls is no heavier than one built from one.
    this.mass = config.mass ?? DEFAULT_MASS;
    const reach = propReach(config.shape);
    this.localCentre = reach.centre;
    this.horizontalRadius = reach.radius;
    this.radius = reach.sphere;
    const perCollider = this.mass / descs.length;
    this.colliders = descs.map((desc) =>
      world.createCollider(desc.setMass(perCollider).setFriction(friction).setCollisionGroups(PROP_GROUPS), this.body),
    );
    // A Projectile waits inside its Shooter: nothing to hit, nothing to draw.
    if (config.projectile === true) this.park(config.center);
  }

  /**
   * Push the prop by the Character's horizontal velocity at the moment of
   * contact. Skipped once the prop is already moving at or past the push
   * speed along that direction, so continuous contact (the Character walking
   * into it for seconds at a time) carries it along rather than stacking a
   * fresh impulse every tick without bound.
   */
  shove(characterVelocity: Vec3): void {
    const push = scaleVec3(vec3(characterVelocity.x, 0, characterVelocity.z), PROP_PUSH_SCALE);
    const pushSpeed = lengthVec3(push);
    if (pushSpeed === 0) return;

    const current = this.body.linvel();
    const alongPush = (current.x * push.x + current.z * push.z) / pushSpeed;
    if (alongPush < pushSpeed) this.body.applyImpulse(push, true);
  }

  /**
   * Client prediction only (ticket 06, ADR 0012): pin the Prop to the server's
   * snapshot pose, inert. A Prop nobody local is pushing is never simulated on
   * the client — it just follows the authoritative snapshot, the same as a
   * mirrored other-player Character. Velocity is zeroed so it doesn't
   * accumulate gravity or a stale shove between the ticks it's followed.
   */
  follow(pose: PropSnapshot): void {
    this.body.setTranslation(pose.position, true);
    this.body.setRotation(pose.rotation, true);
    this.body.setLinvel(ZERO, true);
    this.body.setAngvel(ZERO, true);
  }

  /**
   * Client prediction only (ADR 0022): overwrite the body's dynamic state with
   * the server's authoritative one, so the locally simulated Prop converges on
   * the server instead of replaying from a standstill every snapshot. The body
   * always holds a *valid physical* state — the visual smoothing (a decaying
   * error offset) is applied by the renderer, never here (Fiedler: smoothing
   * between the state set and the sim step ruins the extrapolation).
   *
   * Linear velocity is **aligned-gated**: skipped when it opposes the body's
   * current motion (`dot < 0`), so a box that has just hit a wall locally — a
   * collision the server's older snapshot has not resolved yet — is not yanked
   * back toward its stale pre-collision velocity. Position is still snapped, so
   * the replay cannot drift far; the velocity re-converges on the first
   * snapshot in which the server has seen the same collision. This gate is
   * deliberately on the reconcile path (research `m2-shared-prop-prediction.md`
   * §6.3, matching Unity Ultimate Glove Ball's `BallStateSync` ll. 326–339) —
   * it is our extension, not a Fiedler citation. Angular velocity is snapped
   * unconditionally — Fiedler's rule for derivative quantities.
   *
   * No `pose.velocity` at all means the *server* reports the Prop `atRest` —
   * not a real zero target to align against, just an omitted field. Treating
   * it as one would always pass the `dot >= 0` gate (anything dotted with the
   * zero vector is 0) and force-zero a Prop the local Character just pushed,
   * every time, before the server has had a chance to see the push — so that
   * case skips the velocity write entirely and leaves the local prediction to
   * run (and settle) on its own.
   */
  applyAuthoritativeState(pose: PropSnapshot): void {
    this.body.setTranslation(pose.position, true);
    this.body.setRotation(pose.rotation, true);
    if (pose.velocity) {
      const current = this.body.linvel();
      const aligned =
        current.x * pose.velocity.x + current.y * pose.velocity.y + current.z * pose.velocity.z;
      if (aligned >= 0) this.body.setLinvel(pose.velocity, true);
    }
    this.body.setAngvel(pose.angularVelocity ?? ZERO, true);
  }

  /**
   * Fire this ball from `position` at `velocity` (ADR 0119): awake, moving,
   * and collidable from this Tick. A Projectile waits inside its Shooter
   * between shots rather than being created, so firing is a placement, not a
   * birth — and the `live` flag on its snapshot is what tells a renderer the
   * difference between the two.
   */
  fire(position: Vec3, velocity: Vec3): void {
    // `position` is where its middle leaves from: a ball's body is its middle,
    // a Shooter's bomb's is the pivot at its foot (ADR 0127).
    this.body.setTranslation(subVec3(position, this.localCentre), true);
    this.body.setRotation(IDENTITY_QUAT, true);
    this.body.setLinvel(velocity, true);
    this.body.setAngvel(ZERO, true);
    this.setLive(true);
  }

  /** Take it out of play at `position` — its lifetime is up (ADR 0119). Never on a hit: a spent ball keeps rolling. */
  park(position: Vec3): void {
    this.body.setTranslation(position, false);
    this.body.setLinvel(ZERO, false);
    this.body.setAngvel(ZERO, false);
    this.body.sleep();
    this.setLive(false);
  }

  /**
   * Back where the Track placed it (ADR 0126): a spent bomb returning, unlit,
   * at rest and collidable, exactly as it stood at the start of the Round.
   */
  home(): void {
    this.body.setTranslation(this.config.center, true);
    this.body.setRotation(this.config.rotation ?? IDENTITY_QUAT, true);
    this.body.setLinvel(ZERO, true);
    this.body.setAngvel(ZERO, true);
    this.setLive(true);
    this.body.sleep();
  }

  /** Change its velocity by `deltaV` (units/s) — a blast's push (ADR 0126), the same for a cone as for a ball. */
  push(deltaV: Vec3): void {
    this.body.applyImpulse(scaleVec3(deltaV, this.mass), true);
  }

  /**
   * Client only (ADR 0126): whether the snapshot says it is in play. A spent
   * bomb has nothing to collide with here either, or the local Character
   * would walk into one nobody can see.
   */
  followLive(live: boolean): void {
    this.setLive(live);
  }

  private setLive(live: boolean): void {
    if (live === this.live) return;
    this.live = live;
    this.syncColliders();
  }

  /** Colliders on exactly while it is in play and in nobody's hands. */
  private syncColliders(): void {
    const on = this.live && this.carrier === null;
    for (const collider of this.colliders) if (collider.isEnabled() !== on) collider.setEnabled(on);
  }

  /** Who is carrying it, or `null` (ADR 0125). */
  get carriedBy(): string | null {
    return this.carrier;
  }

  /**
   * Picked up by `carrierId`, facing `facing` (ADR 0125): kinematic from now
   * on, with nothing to collide with, held at the rotation it had relative to
   * its carrier so it turns as one with it.
   */
  carry(carrierId: string, facing: number): void {
    this.carrier = carrierId;
    this.carriedTurn = mulQuat(conjugateQuat(yawQuat(facing)), this.rotation);
    this.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    this.body.setLinvel(ZERO, false);
    this.body.setAngvel(ZERO, false);
    this.syncColliders();
  }

  /** Where its carrier holds it this Tick: its middle at `point`, turned with the carrier's `facing`. */
  placeCarried(point: Vec3, facing: number): void {
    const rotation = mulQuat(yawQuat(facing), this.carriedTurn);
    this.body.setTranslation(subVec3(point, rotateVec3ByQuat(this.localCentre, rotation)), false);
    this.body.setRotation(rotation, false);
  }

  /**
   * Let go of (ADR 0125): a dynamic body again, collidable, moving at
   * `velocity` — put down with the carry's own velocity, or thrown.
   */
  release(velocity: Vec3): void {
    if (this.carrier === null) return;
    this.carrier = null;
    this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.syncColliders();
    this.body.setLinvel(velocity, true);
    this.body.setAngvel(ZERO, true);
  }

  /**
   * Client only (ADR 0125): what the snapshot says about who carries it. A
   * carried Prop is pinned like every other, with its colliders off, so the
   * carrier's own prediction never walks into what it is holding.
   */
  followCarrier(carrierId: string | null): void {
    if (carrierId === this.carrier) return;
    this.carrier = carrierId;
    // Kinematic while carried, as on the server: a dynamic body with every
    // collider off has no mass left to integrate.
    this.body.setBodyType(carrierId === null ? RAPIER.RigidBodyType.Dynamic : RAPIER.RigidBodyType.KinematicPositionBased, true);
    this.syncColliders();
  }

  /** Where its body is, in the world — the Asset pivot, which {@link park} and {@link config}'s `center` speak in. */
  get position(): Vec3 {
    const t = this.body.translation();
    return vec3(t.x, t.y, t.z);
  }

  /** Where its middle is, in the world. */
  get centre(): Vec3 {
    const t = this.body.translation();
    return addVec3(vec3(t.x, t.y, t.z), rotateVec3ByQuat(this.localCentre, this.rotation));
  }

  private get rotation(): Quat {
    const r = this.body.rotation();
    return { x: r.x, y: r.y, z: r.z, w: r.w };
  }

  /** Whether this Projectile is in flight — always true for an ordinary Prop. */
  get inFlight(): boolean {
    return this.live;
  }

  /** How fast the body is going right now, world space — what the Impact rule closes against. */
  get velocity(): Vec3 {
    const v = this.body.linvel();
    return vec3(v.x, v.y, v.z);
  }

  snapshot(): PropSnapshot {
    const t = this.body.translation();
    const r = this.body.rotation();
    const atRest = this.body.isSleeping();
    const base: PropSnapshot = {
      position: vec3(t.x, t.y, t.z),
      rotation: { x: r.x, y: r.y, z: r.z, w: r.w },
      atRest,
      ...(this.config.projectile === true || this.config.bomb !== undefined ? { live: this.live } : {}),
      ...(this.carrier === null ? {} : { carriedBy: this.carrier }),
    };
    if (atRest) return base;
    const v = this.body.linvel();
    const w = this.body.angvel();
    return { ...base, velocity: vec3(v.x, v.y, v.z), angularVelocity: vec3(w.x, w.y, w.z) };
  }
}

/** A turn of `facing` about +Y — `facing`'s own convention: forward is (sin f, 0, −cos f). */
const yawQuat = (facing: number): Quat => ({ x: 0, y: Math.sin(-facing / 2), z: 0, w: Math.cos(-facing / 2) });

/**
 * The middle of a Prop's shape and how far it reaches across the ground from
 * there — a box or ball's own size, or an Asset's solid parts gathered.
 */
const propReach = (shape: PropShape): { centre: Vec3; radius: number; sphere: number } => {
  if (shape.kind === "ball") return { centre: vec3(), radius: shape.radius, sphere: shape.radius };
  if (shape.kind === "box") {
    const h = shape.halfExtents;
    return { centre: vec3(), radius: Math.hypot(h.x, h.z), sphere: Math.hypot(h.x, h.y, h.z) };
  }
  const points: Vec3[] = [];
  for (const part of shape.parts) {
    const s = part.shape;
    const corners: Vec3[] =
      s.type === "hull"
        ? s.points
        : (() => {
            const h =
              s.type === "box"
                ? s.halfExtents
                : s.type === "ball"
                  ? vec3(s.radius, s.radius, s.radius)
                  : vec3(s.radius, s.halfHeight + (s.type === "capsule" ? s.radius : 0), s.radius);
            const out: Vec3[] = [];
            for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) out.push(vec3(x * h.x, y * h.y, z * h.z));
            return out;
          })();
    for (const corner of corners) points.push(addVec3(rotateVec3ByQuat(corner, part.rotation), part.position));
  }
  if (points.length === 0) return { centre: vec3(), radius: 0.1, sphere: 0.1 };
  const min = vec3(Infinity, Infinity, Infinity);
  const max = vec3(-Infinity, -Infinity, -Infinity);
  for (const p of points) {
    min.x = Math.min(min.x, p.x);
    min.y = Math.min(min.y, p.y);
    min.z = Math.min(min.z, p.z);
    max.x = Math.max(max.x, p.x);
    max.y = Math.max(max.y, p.y);
    max.z = Math.max(max.z, p.z);
  }
  const centre = vec3((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
  return {
    centre,
    radius: Math.max(...points.map((p) => Math.hypot(p.x - centre.x, p.z - centre.z))),
    sphere: Math.max(...points.map((p) => Math.hypot(p.x - centre.x, p.y - centre.y, p.z - centre.z))),
  };
};

