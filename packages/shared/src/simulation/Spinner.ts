import RAPIER from "@dimforge/rapier3d-compat";
import { yawQuat } from "../math/quat.js";
import { addVec3, scaleVec3, subVec3, vec3, type Vec3 } from "../math/vec3.js";
import { SPINNER_KNOCKBACK_LIFT, SPINNER_KNOCKBACK_SCALE, TICK_DT } from "../tuning.js";
import { OBSTACLE_GROUPS } from "./collisionGroups.js";

export interface SpinnerConfig {
  /** Centre of the bar's vertical rotation axis. */
  center: Vec3;
  /** Half the bar's total length — distance from the axis to each tip. */
  armLength: number;
  /** Half-height of the bar's collision box (units). */
  halfHeight: number;
  /** Radius/half-thickness of the bar (units). */
  armRadius: number;
  /** Radians per second; sign gives the spin direction. */
  angularSpeed: number;
  /** Starting angle (radians). Defaults to 0. */
  initialAngle?: number;
}

/**
 * The bar's rotation angle (radians) at simulation tick `tick`. `tick` may be
 * fractional — the renderer uses this to interpolate smoothly between ticks.
 */
export const spinnerAngleAt = (config: SpinnerConfig, tick: number): number =>
  (config.initialAngle ?? 0) + config.angularSpeed * tick * TICK_DT;

/**
 * Knockback for a Character hit at world-space `point`: tangential to the
 * spin at that radius from `center` (v = ω × r, around the Y axis), so a hit
 * near the tip lands harder than a graze near the axle. Always adds the same
 * small upward lift.
 */
export const spinnerKnockback = (center: Vec3, angularSpeed: number, point: Vec3): Vec3 => {
  const r = subVec3(point, center);
  const tangential = vec3(angularSpeed * r.z, 0, -angularSpeed * r.x);
  return addVec3(scaleVec3(tangential, SPINNER_KNOCKBACK_SCALE), vec3(0, SPINNER_KNOCKBACK_LIFT, 0));
};

/**
 * One rotating-bar Obstacle (ticket 06): a kinematic body spinning at a
 * constant rate around a vertical axis. `RapierSimulation` advances its
 * rotation each tick and resolves Character contact into a Knockback via
 * {@link knockbackAt}.
 */
export class Spinner {
  readonly config: SpinnerConfig;
  readonly collider: RAPIER.Collider;
  private readonly body: RAPIER.RigidBody;

  constructor(world: RAPIER.World, config: SpinnerConfig) {
    this.config = config;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(config.center.x, config.center.y, config.center.z)
        .setRotation(yawQuat(spinnerAngleAt(config, 0))),
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(config.armLength, config.halfHeight, config.armRadius).setCollisionGroups(
        OBSTACLE_GROUPS,
      ),
      this.body,
    );
  }

  /** Queue the bar's rotation for simulation tick `tick`, applied at the next `world.step()`. */
  tick(tick: number): void {
    this.body.setNextKinematicRotation(yawQuat(spinnerAngleAt(this.config, tick)));
  }

  /** The Knockback impulse for a Character hit at world-space `point`. */
  knockbackAt(point: Vec3): Vec3 {
    return spinnerKnockback(this.config.center, this.config.angularSpeed, point);
  }
}
