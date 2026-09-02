import { lengthVec3, normalizeVec3, scaleVec3, vec3, type Vec3 } from "../math/vec3.js";
import {
  COYOTE_TICKS,
  DASH_COOLDOWN_TICKS,
  DASH_DURATION_TICKS,
  DASH_RELEASE_TICKS,
  DASH_SPEED,
  JUMP_HOLD_GRAVITY_SCALE,
  JUMP_HOLD_MAX_TICKS,
  JUMP_VELOCITY,
  TICK_MS,
} from "../tuning.js";

const smoothstep = (x: number): number => x * x * (3 - 2 * x);

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

/**
 * Dash: a fixed-speed horizontal burst along the move direction (or the last
 * non-zero one if idle), on a cooldown.
 */
export class DashController {
  private ticksLeft = 0;
  private cooldownTicks = 0;
  private dir: Vec3 = vec3();
  private lastMoveDir: Vec3 = vec3();

  reset(): void {
    this.ticksLeft = 0;
    this.cooldownTicks = 0;
    this.dir = vec3();
    this.lastMoveDir = vec3();
  }

  /** Milliseconds left on the cooldown; 0 when Dash is ready. */
  get cooldownMs(): number {
    return this.cooldownTicks * TICK_MS;
  }

  /**
   * Restore the cooldown from a reconciliation base (ticket 05) — the server's
   * `dashCooldownMs`, rounded back to whole ticks, for the ACKED tick this
   * reconcile targets (the caller replays every tick since forward from here —
   * see below).
   *
   * A burst in progress is ended **only if the server disagrees** that one is
   * still playing out (`stillDashing` false). 2026-09 regression: this used
   * to end *every* burst unconditionally, on the reasoning that "mid-dash
   * reconciliation is rare." ADR 0026 made the *sim* reconcile on any
   * disagreement past a float-noise epsilon (not the old one-walk-step gate)
   * — and Dash moves ~2.5× walk speed, so an ordinary same-tick phase slip
   * crosses that epsilon on nearly every tick of a burst. Reconciliation
   * during a dash is now the norm, not the exception, so unconditionally
   * zeroing `ticksLeft` here killed the burst's speed contribution outright
   * on almost every dash — even one the server's own snapshot confirms is
   * still legitimately in flight (`CharacterSnapshot.dashing`).
   *
   * When kept alive, `ticksLeft` is **re-derived from the reported cooldown**
   * — never gated on this Character's own CURRENT `ticksLeft` (a first
   * attempt at this fix checked `this.ticksLeft > 0` before reassigning, as a
   * "don't invent a burst from nothing" safety rail; it was wrong: by the
   * time this runs, `this.ticksLeft` already reflects every tick this
   * Character predicted PAST the acked one — which the caller is about to
   * replay forward *again* — not whether the ACKED tick had an active burst,
   * which `stillDashing` already tells us directly. Under any repeated
   * reconciliation this occasionally read as "not active" purely because the
   * client's own free-running prediction had already ticked itself to 0 one
   * step ahead of the acked tick, silently discarding a burst the server
   * confirmed was still live at that tick — the exact "slight forward jump
   * at the tail of the burst" this fix targets. `stillDashing` alone is the
   * right and sufficient gate: this is only ever called to reconcile the
   * LOCAL player's own Character, whose dash is always client-predicted
   * first — the server can only ever confirm a burst this Character's own
   * earlier prediction already started, so `dir` (never touched here) is
   * always meaningful whenever `stillDashing` is true.
   *
   * `cooldownTicks` and `ticksLeft` tick down together from the instant a
   * burst starts, but one tick out of phase: the press tick sets
   * `cooldownTicks = DASH_COOLDOWN_TICKS` fresh (no decrement that same tick,
   * since the decrement in `beginTick` runs *before* a fresh press is
   * detected) while `ticksLeft` is set to `DASH_DURATION_TICKS` and then
   * immediately decremented once, that same tick. So `elapsedSinceStart`
   * (ticks since the press, inclusive) is `DASH_COOLDOWN_TICKS + 1 -
   * cooldownTicks`, not `DASH_COOLDOWN_TICKS - cooldownTicks` — and
   * `ticksLeft = DASH_DURATION_TICKS - elapsedSinceStart` recovers what it
   * must have been AT THE ACKED TICK, for the caller's replay to re-advance
   * correctly from (regression test: `RapierSimulation.test.ts` ›
   * "reconciles EVERY tick, across two back-to-back dashes...").
   */
  restoreCooldownMs(ms: number, stillDashing: boolean): void {
    this.cooldownTicks = Math.max(0, Math.round(ms / TICK_MS));
    if (stillDashing) {
      const elapsedSinceStart = DASH_COOLDOWN_TICKS + 1 - this.cooldownTicks;
      this.ticksLeft = Math.max(0, DASH_DURATION_TICKS - elapsedSinceStart);
    } else {
      this.ticksLeft = 0;
    }
  }

  /** Whether a burst is currently playing out (as opposed to merely on cooldown). */
  get isActive(): boolean {
    return this.ticksLeft > 0;
  }

  /** Advance dash bookkeeping and return the extra horizontal velocity for this tick. */
  beginTick(moveDirection: Vec3, dashPressed: boolean): Vec3 {
    if (this.cooldownTicks > 0) this.cooldownTicks -= 1;
    if (lengthVec3(moveDirection) > 0) this.lastMoveDir = { ...moveDirection };

    if (dashPressed && this.cooldownTicks === 0) {
      const source = lengthVec3(moveDirection) > 0 ? moveDirection : this.lastMoveDir;
      if (lengthVec3(source) > 0) {
        this.dir = normalizeVec3(source);
        this.ticksLeft = DASH_DURATION_TICKS;
        this.cooldownTicks = DASH_COOLDOWN_TICKS;
      }
    }

    if (this.ticksLeft > 0) {
      const elapsed = DASH_DURATION_TICKS - this.ticksLeft + 0.5; // sample mid-tick
      this.ticksLeft -= 1;
      const speed = DASH_SPEED * dashEnvelope(elapsed, DASH_DURATION_TICKS, DASH_RELEASE_TICKS);
      return scaleVec3(this.dir, speed);
    }
    return vec3();
  }
}
