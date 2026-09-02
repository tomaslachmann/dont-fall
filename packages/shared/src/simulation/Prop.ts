import RAPIER from "@dimforge/rapier3d-compat";
import type { Quat } from "../math/quat.js";
import { lengthVec3, scaleVec3, vec3, type Vec3 } from "../math/vec3.js";
import { PROP_PUSH_SCALE } from "../tuning.js";
import { PROP_GROUPS } from "./collisionGroups.js";

export type PropShape = { kind: "box"; halfExtents: Vec3 } | { kind: "ball"; radius: number };

export interface PropConfig {
  shape: PropShape;
  /** Starting position (body centre). */
  center: Vec3;
  mass?: number;
  friction?: number;
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
  readonly collider: RAPIER.Collider;
  private readonly body: RAPIER.RigidBody;

  constructor(world: RAPIER.World, config: PropConfig) {
    this.config = config;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(config.center.x, config.center.y, config.center.z),
    );
    const desc =
      config.shape.kind === "box"
        ? RAPIER.ColliderDesc.cuboid(
            config.shape.halfExtents.x,
            config.shape.halfExtents.y,
            config.shape.halfExtents.z,
          )
        : RAPIER.ColliderDesc.ball(config.shape.radius);
    this.collider = world.createCollider(
      desc
        .setMass(config.mass ?? DEFAULT_MASS)
        .setFriction(config.friction ?? DEFAULT_FRICTION)
        .setCollisionGroups(PROP_GROUPS),
      this.body,
    );
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
   */
  applyAuthoritativeState(pose: PropSnapshot): void {
    this.body.setTranslation(pose.position, true);
    this.body.setRotation(pose.rotation, true);
    const target = pose.velocity ?? ZERO;
    const current = this.body.linvel();
    const aligned = current.x * target.x + current.y * target.y + current.z * target.z;
    if (aligned >= 0) this.body.setLinvel(target, true);
    this.body.setAngvel(pose.angularVelocity ?? ZERO, true);
  }

  snapshot(): PropSnapshot {
    const t = this.body.translation();
    const r = this.body.rotation();
    const atRest = this.body.isSleeping();
    const base: PropSnapshot = {
      position: vec3(t.x, t.y, t.z),
      rotation: { x: r.x, y: r.y, z: r.z, w: r.w },
      atRest,
    };
    if (atRest) return base;
    const v = this.body.linvel();
    const w = this.body.angvel();
    return { ...base, velocity: vec3(v.x, v.y, v.z), angularVelocity: vec3(w.x, w.y, w.z) };
  }
}
