import { vec3, type Vec3 } from "../math/vec3.js";
import { TICK_DT } from "../tuning/clock.js";
import { GRAB_CARRY_DISTANCE, SPIN_MAX_SPEED, SPIN_WINDUP_TICKS } from "../tuning/fight.js";

/**
 * The Spin (ADR 0104) as pure functions of how many ticks it has run — so the
 * grabber's own client predicts exactly the turn the server makes, and a
 * reconcile needs only the tick count and the facing to carry on from.
 *
 * It speeds up evenly from standing to {@link SPIN_MAX_SPEED} over
 * {@link SPIN_WINDUP_TICKS}, then holds. One direction only: facing grows.
 */

/** How far the Spin has wound up after `ticks`, 0..1 — how hard a Hurl released now leaves. */
export const spinWindup = (ticks: number): number => Math.min(1, Math.max(0, ticks) / SPIN_WINDUP_TICKS);

/** The Spin's speed (rad/s) on its `ticks`-th tick. */
export const spinSpeedAt = (ticks: number): number => SPIN_MAX_SPEED * spinWindup(ticks);

/**
 * How far (rad) a Spin has turned after `ticks` — the sum of every tick's own
 * step, in closed form so the angle a reconcile restores from is the same one
 * the ticks would have summed to.
 */
export const spinAngleAt = (ticks: number): number => {
  const n = Math.max(0, Math.floor(ticks));
  const perTick = (SPIN_MAX_SPEED * TICK_DT) / SPIN_WINDUP_TICKS;
  if (n <= SPIN_WINDUP_TICKS) return (perTick * n * (n + 1)) / 2;
  const windup = (perTick * SPIN_WINDUP_TICKS * (SPIN_WINDUP_TICKS + 1)) / 2;
  return windup + SPIN_MAX_SPEED * TICK_DT * (n - SPIN_WINDUP_TICKS);
};

/** Straight ahead of a body turned to `facing` (ADR 0045: yaw 0 looks down −Z). */
export const forwardOf = (facing: number): Vec3 => vec3(Math.sin(facing), 0, -Math.cos(facing));

/**
 * Which way the carry point is moving while a Spin turns `facing` up — the
 * derivative of {@link forwardOf}. What a Hurl leaves along, before any aim.
 */
export const spinTangentOf = (facing: number): Vec3 => vec3(Math.cos(facing), 0, Math.sin(facing));

/** How fast (units/s) the carry point moves on the Spin's `ticks`-th tick — the swung body's speed. */
export const carrySpeedAt = (ticks: number): number => spinSpeedAt(ticks) * GRAB_CARRY_DISTANCE;
