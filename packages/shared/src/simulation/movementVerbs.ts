import { addVec3, dotVec3, lengthVec3, normalizeVec3, scaleVec3, subVec3, type Vec3 } from "../math/vec3.js";
import {
  COYOTE_TICKS,
  JUMP_HOLD_GRAVITY_SCALE,
  JUMP_HOLD_MAX_TICKS,
  JUMP_VELOCITY,
  MOVE_STOP_SPEED,
  MOVE_VELOCITY_CAP,
  SLOPE_SPEED_ANGLE_FACTOR,
  SLOPE_SPEED_MULTIPLIER_MIN,
  SPEED_PAD_FADE_MS,
  SPEED_PAD_HOLD_MS,
  TICK_DT,
  TICK_MS,
} from "../tuning.js";

const smoothstep = (x: number): number => x * x * (3 - 2 * x);

/**
 * Walking (not `Sliding`) speed multiplier from the **signed slope angle
 * toward the movement direction** (ticket 04, M3.6) — the model Unity's
 * Character Controller package documentation recommends
 * (`GetSlopeAngleTowardsDirection`): "positive if the slope goes up, and
 * negative if the slope goes down… apply a multiplier to your desired
 * character velocity based on that signed slope angle." A pure function of
 * `(moveDirection, groundNormal)` — sidestepping across a slope
 * (perpendicular to its fall line) computes ~0 rad and multiplies by ~1,
 * exactly as it should; standing still (`moveDirection` zero) has no
 * direction to be uphill/downhill *toward*, so this returns 1 rather than
 * an arbitrary angle.
 *
 * Quake 3 deliberately does the opposite: `PM_WalkMove` re-normalises ground
 * velocity onto the floor plane after the move, which keeps speed
 * slope-independent *by design*, not by oversight — a documented alternative
 * tradition this project chose not to follow, since ticket 04's own
 * "downhill is faster, uphill is slower" requirement rules it out.
 *
 * Deliberately never used for `Sliding`: that state projects gravity onto
 * the slope plane and integrates it — the rigid-body formulation ADR 0035
 * reserves for ground too steep to walk. This is strictly the walking
 * (Controlled/Stagger) model, and only ever called below the walkable limit.
 */
export const slopeSpeedMultiplier = (moveDirection: Vec3, groundNormal: Vec3): number => {
  const dir = normalizeVec3(moveDirection);
  if (dir.x === 0 && dir.z === 0) return 1;
  // Rise of the ground plane per unit horizontal distance travelled along
  // `dir`, from the plane equation normal·(p - p0) = 0 solved for dy/dd.
  const rise = -(groundNormal.x * dir.x + groundNormal.z * dir.z) / groundNormal.y;
  const signedSlopeAngle = Math.atan(rise); // positive = uphill, negative = downhill (Unity's convention)
  return Math.max(SLOPE_SPEED_MULTIPLIER_MIN, 1 - SLOPE_SPEED_ANGLE_FACTOR * signedSlopeAngle);
};

/**
 * The Character's horizontal (X/Z) move velocity for one tick: Friction()
 * then Accelerate() then a cap (ticket 05, M3.6, ADR 0035) — replacing the
 * old direct `velocity.xz = wish` assignment. Source's own shape exactly
 * (`gamemovement.cpp`'s `Friction()`/`Accelerate()`, and Quake 3's
 * `PM_Friction`/`PM_Accelerate` do the same thing), not a simpler
 * from-scratch design: an earlier draft of this function stepped both drag
 * and acceleration by a flat, equal-magnitude units/s² amount each tick, and
 * at low speed the two fully cancelled each other every tick, permanently
 * stalling at a small fraction of the target no matter how long input was
 * held. Source's shapes don't have this failure mode because they scale
 * from *different* quantities — Accelerate()'s step scales with the
 * comparatively large, roughly-constant *target* speed (`wishSpeed`), while
 * Friction()'s scales with the (initially small) *current* speed — so the
 * two forces don't race each other to the same fixed point.
 *
 * `MOVE_STOP_SPEED` floors Friction()'s "control" term so a small residual
 * speed still gets a clean, fast stop instead of an exponential tail that
 * never quite reaches zero — Source's own documented reason for the same
 * floor. At today's `MOVE_ACCEL_FACTOR`/`MOVE_FRICTION_FACTOR` (chosen to
 * saturate every tick) both stages fully complete in one tick regardless of
 * `MOVE_STOP_SPEED`'s value, making the new pipeline numerically
 * **identical** to the direct assignment it replaces — this ticket's whole
 * job is introducing the shape, not changing feel. A separately-tuned,
 * genuinely gradual pair of factors (a future Surface, ticket 06 — ice's
 * near-zero grip) is what turns this into a real ramp.
 *
 * `y` is always 0 on the result regardless of `current`/`wish`'s own `y` —
 * this is strictly the horizontal pipeline; vertical velocity (gravity,
 * jump, ground-stick) is integrated separately by the caller.
 */
export const accelerateVelocity = (current: Vec3, wish: Vec3, accelFactor: number, frictionFactor: number): Vec3 => {
  let velocity: Vec3 = { x: current.x, y: 0, z: current.z };

  // Friction() — reduces whatever speed `velocity` already has, independent
  // of `wish`, toward zero.
  const speed = lengthVec3(velocity);
  if (speed > 0) {
    const control = Math.max(speed, MOVE_STOP_SPEED);
    const drop = control * frictionFactor * TICK_DT;
    const newSpeed = Math.max(speed - drop, 0);
    velocity = scaleVec3(velocity, newSpeed / speed);
  }

  // Accelerate() — adds speed along `wish`'s own direction, capped at the
  // remaining gap to `wishSpeed` (never overshoots it in a single tick).
  const wishFlat: Vec3 = { x: wish.x, y: 0, z: wish.z };
  const wishSpeed = lengthVec3(wishFlat);
  if (wishSpeed > 0) {
    const wishDir = scaleVec3(wishFlat, 1 / wishSpeed);
    const currentSpeedAlongWish = velocity.x * wishDir.x + velocity.z * wishDir.z;
    const addSpeed = wishSpeed - currentSpeedAlongWish;
    if (addSpeed > 0) {
      const accelSpeed = Math.min(accelFactor * wishSpeed * TICK_DT, addSpeed);
      velocity = addVec3(velocity, scaleVec3(wishDir, accelSpeed));
    }
  }

  const finalSpeed = lengthVec3(velocity);
  if (finalSpeed > MOVE_VELOCITY_CAP) velocity = scaleVec3(velocity, MOVE_VELOCITY_CAP / finalSpeed);

  return velocity;
};

/**
 * A Volume's per-tick contribution to a Character's velocity (M3.7 ticket 04,
 * ADR 0036) — an unconditional additive accelerate, unlike
 * {@link accelerateVelocity}'s friction-then-accelerate walk model, because a
 * Volume competes with whatever else is already acting on the Character
 * (gravity, an in-flight Dash, another Volume's own prior tick) rather than
 * replacing it. Adds `force * TICK_DT`, then clamps only the resulting
 * component *along `force`'s own direction* to `maxInducedSpeed` — leaving
 * every other component of `velocity` untouched, so an updraft caps how fast
 * it can push a Character up without also flattening whatever horizontal
 * drift the Character walked in with. A `force` already pushing along a
 * direction where `velocity` is at or beyond the cap contributes nothing
 * further that tick (never pulls the Character back down) — "never exceeded"
 * from {@link VolumeConfig.maxInducedSpeed}'s own doc comment, not "clamped
 * to exactly."
 */
export const applyVolumeForce = (velocity: Vec3, force: Vec3, maxInducedSpeed: number): Vec3 => {
  const forceMagnitude = lengthVec3(force);
  if (forceMagnitude === 0) return velocity;
  const dir = scaleVec3(force, 1 / forceMagnitude);
  const currentAlong = dotVec3(velocity, dir);
  if (currentAlong >= maxInducedSpeed) return velocity;
  const candidate = addVec3(velocity, scaleVec3(dir, forceMagnitude * TICK_DT));
  const candidateAlong = dotVec3(candidate, dir);
  if (candidateAlong <= maxInducedSpeed) return candidate;
  return subVec3(candidate, scaleVec3(dir, candidateAlong - maxInducedSpeed));
};

/**
 * The dash speed envelope: a "nitro" build — {@link smoothstep}-eased up to
 * full speed continuously across the whole burst (never plateaus early), then
 * released back to 0 over the final `rampOut`, so it doesn't cut dead at full
 * speed. `elapsed` and `duration` are in ticks. If `rampOut` covers the whole
 * `duration` there is no build at all, just the release curve throughout.
 */
export const dashEnvelope = (elapsed: number, duration: number, rampOut: number): number => {
  if (elapsed <= 0 || elapsed >= duration) return 0;
  const clampedRampOut = Math.min(rampOut, duration);
  const releaseStart = duration - clampedRampOut;
  if (releaseStart <= 0) return smoothstep((duration - elapsed) / duration);
  if (elapsed < releaseStart) return smoothstep(elapsed / releaseStart);
  return smoothstep((duration - elapsed) / clampedRampOut);
};

/**
 * A speed/slow pad's `WALK_SPEED` multiplier at `elapsedMs` since it fired
 * (M3.7 ticket 01, ADR 0035) — SuperTuxKart's zipper shape: held at `peak`
 * for `holdMs`, then a *linear* fade back to 1 (neutral) over `fadeMs`, then
 * 1 forever after. Deliberately not {@link dashEnvelope}'s smoothstep
 * build/release curve: a pad's peak applies instantly (the one-shot velocity
 * write in `CharacterController` is what makes that felt immediately, not a
 * ramp-up here), and SuperTuxKart's own fade-out is linear, not eased.
 */
export const speedPadCapMultiplier = (elapsedMs: number, holdMs: number, fadeMs: number, peak: number): number => {
  if (elapsedMs < 0 || elapsedMs >= holdMs + fadeMs) return 1;
  if (elapsedMs < holdMs) return peak;
  const fadeT = (elapsedMs - holdMs) / fadeMs;
  return peak + (1 - peak) * fadeT;
};

/**
 * A speed/slow pad's fading-cap bookkeeping (M3.7 ticket 01) — the same
 * "start now, count down, restore from a reported remainder" idiom as
 * {@link DashController}'s cooldown, because a pad's effect is a *latched*
 * modifier that outlives contact with the pad itself (ADR 0035: the
 * alternative, a stateless "only while standing on the pad" cap, was
 * rejected — a boost that dies the moment you step off feels like a
 * treadmill). `elapsedMs` free-runs past the total window once inactive
 * rather than resetting to 0, so {@link msLeft} reads as a clean 0 instead of
 * needing a separate "active" flag to disagree with a stale elapsed value.
 */
export class SpeedPadController {
  private elapsedMs = SPEED_PAD_HOLD_MS + SPEED_PAD_FADE_MS;
  private peakCapMultiplier = 1;

  reset(): void {
    this.elapsedMs = SPEED_PAD_HOLD_MS + SPEED_PAD_FADE_MS;
    this.peakCapMultiplier = 1;
  }

  /** This tick's `WALK_SPEED` multiplier from this pad's fading effect; 1 whenever inactive. */
  get capMultiplier(): number {
    return speedPadCapMultiplier(this.elapsedMs, SPEED_PAD_HOLD_MS, SPEED_PAD_FADE_MS, this.peakCapMultiplier);
  }

  /** Ms remaining until this effect fully fades back to neutral; 0 whenever inactive. */
  get msLeft(): number {
    return Math.max(0, SPEED_PAD_HOLD_MS + SPEED_PAD_FADE_MS - this.elapsedMs);
  }

  /** The peak this effect is holding/fading from — meaningless once {@link msLeft} is 0, but always the last one latched. */
  get peak(): number {
    return this.peakCapMultiplier;
  }

  /** Latch a fresh pad trigger: (re)start the hold+fade window at `capMultiplier`. */
  trigger(capMultiplier: number): void {
    this.elapsedMs = 0;
    this.peakCapMultiplier = capMultiplier;
  }

  /** Advance one tick — call unconditionally, whether or not a pad is currently active. */
  beginTick(): void {
    this.elapsedMs += TICK_MS;
  }

  /**
   * Reconciliation base (mirrors {@link DashController.restoreCooldownMs}):
   * re-derive `elapsedMs` from the server's reported remainder rather than
   * trusting this Character's own (possibly-discarded-and-replayed)
   * countdown. Never re-triggers the one-shot velocity write — only the
   * decay state — so a client whose reconciliation lands mid-effect keeps
   * fading from the right point instead of losing the effect or restarting it.
   */
  restoreFromMs(msLeft: number, capMultiplier: number): void {
    if (msLeft <= 0) {
      this.reset();
      return;
    }
    this.peakCapMultiplier = capMultiplier;
    this.elapsedMs = Math.max(0, SPEED_PAD_HOLD_MS + SPEED_PAD_FADE_MS - msLeft);
  }
}

/**
 * Jump take-off, coyote time and variable-height ascent. Owns only jump state;
 * the shared vertical velocity stays on the simulation.
 */
export class JumpController {
  private coyoteTicks = 0;
  private jumping = false;
  private holdTicksLeft = 0;

  reset(): void {
    this.coyoteTicks = 0;
    this.jumping = false;
    this.holdTicksLeft = 0;
  }

  /**
   * Advance coyote/jump bookkeeping for this tick. Returns the take-off velocity
   * if a jump starts now, otherwise `null`. `grounded` is the controller's result
   * from the previous tick.
   */
  beginTick(grounded: boolean, jumpPressed: boolean): number | null {
    // Re-arm coyote only when genuinely on the ground and not mid-jump, so a
    // one-tick ground flicker right after take-off can't grant a second jump.
    if (grounded && !this.jumping) this.coyoteTicks = COYOTE_TICKS;
    else if (this.coyoteTicks > 0) this.coyoteTicks -= 1;

    if (jumpPressed && this.coyoteTicks > 0) {
      this.coyoteTicks = 0; // consumed — no coyote re-use, no double jump
      this.jumping = true;
      this.holdTicksLeft = JUMP_HOLD_MAX_TICKS;
      return JUMP_VELOCITY;
    }
    return null;
  }

  /** Gravity multiplier for this tick: <1 while holding jump on the way up, else 1. */
  gravityScale(jumpHeld: boolean, verticalVelocity: number): number {
    if (this.jumping && jumpHeld && verticalVelocity > 0 && this.holdTicksLeft > 0) {
      this.holdTicksLeft -= 1;
      return JUMP_HOLD_GRAVITY_SCALE;
    }
    this.jumping = false;
    return 1;
  }

  land(): void {
    this.jumping = false;
  }
}

