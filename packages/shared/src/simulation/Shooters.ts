import { addVec3, scaleVec3, type Vec3 } from "../math/vec3.js";
import type { ShooterConfig } from "../track/resolveTrack.js";
import { shooterLifeTicks, shooterMuzzleAt, shooterShotAt } from "../track/Shooter.js";
import type { Prop } from "./Prop.js";

/**
 * Every Shooter in a world and the balls it recycles (CONTEXT.md: Shooter /
 * Projectile, ADR 0119).
 *
 * Nothing is created here. Each Shooter's balls exist from the moment the
 * world is built — their number is `shooterShotsInFlight`, known before the
 * Round runs — and a Round only ever fires one and takes it away again. The
 * Tick decides both: which Tick fires, which ball it is, and when its
 * lifetime is up are all pure functions of it, so a server and a client that
 * agree on the Tick agree on every shot without one being announced.
 */
/** How many of its own radii ahead of the muzzle a ball is born, so it never starts inside the barrel. */
const MUZZLE_CLEARANCE = 2.5;

export class Shooters {
  private readonly shooters: { config: ShooterConfig; balls: Prop[]; firedAt: (number | null)[] }[] = [];
  /** How fast each ball was going before this tick's step — see {@link rememberApproach}. */
  private readonly approach = new Map<Prop, Vec3>();

  /**
   * `onFired` hears every shot by the Prop it fired (ADR 0127): a Shooter's
   * bomb is lit by leaving the barrel.
   */
  constructor(
    configs: readonly ShooterConfig[],
    props: readonly Prop[],
    private readonly onFired: (propIndex: number, tick: number) => void = () => {},
  ) {
    for (const config of configs) {
      const balls = config.propIndices.flatMap((index: number) => (props[index] ? [props[index]] : []));
      this.shooters.push({ config, balls, firedAt: balls.map(() => null) });
    }
  }

  get any(): boolean {
    return this.shooters.length > 0;
  }

  /** Fire whatever this Tick fires, and take away whatever has outlived its author's number. */
  tick(tick: number): void {
    for (const shooter of this.shooters) {
      const { aim } = shooter.config;
      const life = shooterLifeTicks(aim.def);
      for (const [slot, ball] of shooter.balls.entries()) {
        const firedAt = shooter.firedAt[slot];
        // A bomb's life ends in its blast, not here (ADR 0127): its fuse is its life.
        if (ball.config.bomb !== undefined) continue;
        if (firedAt !== null && firedAt !== undefined && tick - firedAt >= life) {
          shooter.firedAt[slot] = null;
          ball.park(shooterMuzzleAt(aim, tick).position);
        }
      }
      const shot = shooterShotAt(aim.def, tick);
      if (shot === null || shooter.balls.length === 0) continue;
      // Round-robin, so the ball taken is always the one that has been in the
      // air longest — with the population bounded, it has already been parked.
      const slot = shot % shooter.balls.length;
      const muzzle = shooterMuzzleAt(aim, tick);
      // Clear of the barrel it came out of: born exactly at the muzzle, the
      // ball overlaps the cannon's own collider and the solver shoves it out,
      // which measured as a shot leaving at 15.7 u/s instead of 24.
      // A bomb is taller than the ball it replaces (ADR 0127), so what it
      // clears by is its own reach, never less than the ball's.
      const clearance = Math.max(aim.def.radius * aim.scale, shooter.balls[slot]!.radius) * MUZZLE_CLEARANCE;
      shooter.firedAt[slot] = tick;
      shooter.balls[slot]!.fire(addVec3(muzzle.position, scaleVec3(muzzle.direction, clearance)), scaleVec3(muzzle.direction, aim.def.speed));
      this.onFired(shooter.config.propIndices[slot]!, tick);
    }
  }

  /** Every ball that is in the air right now — what a Character can be hit by. */
  inFlight(): Prop[] {
    return this.shooters.flatMap((shooter) => shooter.balls.filter((ball) => ball.inFlight));
  }

  /**
   * Remember how fast every ball in the air is *arriving*, before the step
   * that may stop it. Measured: read afterwards, a ball that has just hit a
   * Character has already been bounced off the capsule by the solver, so its
   * velocity is what it left with — a full-speed shot read as a shove. A
   * Moving Segment never has this problem because its velocity comes from a
   * pure function of the Tick rather than from the body.
   */
  rememberApproach(): void {
    this.approach.clear();
    for (const shooter of this.shooters) {
      for (const ball of shooter.balls) {
        if (ball.inFlight) this.approach.set(ball, ball.velocity);
      }
    }
  }

  /** How fast `prop` was arriving before this tick's step, if it is a ball in the air. */
  approachOf(prop: Prop): Vec3 | undefined {
    return this.approach.get(prop);
  }

  /** The Tick each Shooter last fired on, for a renderer's recoil and muzzle flash (ADR 0119). */
  lastShots(): { segmentIndex: number; tick: number }[] {
    return this.shooters.flatMap((shooter) => {
      const fired = shooter.firedAt.filter((tick): tick is number => tick !== null);
      return fired.length === 0 ? [] : [{ segmentIndex: shooter.config.segmentIndex, tick: Math.max(...fired) }];
    });
  }
}
