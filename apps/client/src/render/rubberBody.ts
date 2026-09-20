import { GRAVITY_Y } from "@dont-fall/shared";
import * as THREE from "three";
import { settleSpring, SPRING_AT_REST, type SpringState, stepSpring } from "./rubberBones.js";

/**
 * The body itself gives a little (the user's call, 2026-09-20: the bean was
 * reading "moc křečovitě" — too tense — with only its bones bending). An
 * Impact squashes the whole blob and it rings back out, so the Character is
 * made of something soft rather than a rigid shape with bendy limbs on it.
 *
 * Unlike the bones, which are still until something hits them, the body is
 * soft **all the time** (the user's call: "kapsle tělo má být měkčí pořád"):
 * {@link RubberBody.follow} drives it from the Character's own vertical
 * acceleration every frame, so landing compresses it, pushing off stretches
 * it, and it is never quite rigid. An Impact is an extra kick on top of that,
 * not the only thing that moves it.
 *
 * The one thing to know before wiring it into the game: `follow` wants a
 * height the simulation owns, not one derived from a drawn position. M1's
 * procedural Wobble was switched off and later deleted for exactly that —
 * render-frame position deltas under prediction and reconciliation read as
 * micro-stutter. Here the driver is the rig's own animated pose, which is
 * clean; in the game it must come from the same place the speed lines' value
 * does.
 *
 * Squash and stretch, and volume-preserving: what the body loses in height it
 * gains around the middle (`1 / sqrt(k)` on both horizontal axes against `k`
 * vertically), which is what keeps it reading as one mass being compressed
 * rather than a model being scaled.
 *
 * It writes the **model root's** scale, deliberately, and not a bone's. Every
 * `Death_*` clip animates `body.scale`, `head.scale` and `root.scale`, so a
 * layer on those bones would be fighting the mixer for the same property; the
 * group the loader's scene hangs in is the one thing no clip addresses. That
 * also means the scale can be written absolutely each frame instead of
 * multiplied on, so this layer cannot accumulate the way `RubberBones` had to
 * be taught not to.
 *
 * Scaling about the root's own origin — which `createLocalCharacter` and the
 * demo both put at the Character's feet — is what keeps a squashed body
 * standing on the floor instead of sinking through it.
 *
 * Presentation only, on the same terms as the rest of this folder: no
 * simulation reads it, and the Character's Capsule (CONTEXT.md's term, the
 * collider) is untouched — this is the drawn body, which is a different thing
 * wearing a similar name.
 */

/** How the body answers an Impact. Every number here is a first guess until someone drives `rubber.html`. */
export const RUBBER_BODY = {
  /** How much of its own height a full-strength Impact takes off the body at the peak. */
  gain: 0.22,
  /** How long after the Impact the body starts to give (ms) — a touch behind the hips, which lead. */
  delayMs: 10,
  /** Wobble frequency (Hz) — slower than any bone, because it is the whole mass moving. */
  hz: 3,
  /** Damping ratio, below 1 so it overshoots into a stretch on the way back. */
  zeta: 0.32,
  /** Hard clamp either way, as a share of height: at most this much shorter, or this much taller. */
  maxSquash: 0.3,
  /**
   * How much of its height the body gives while it is carried at one
   * {@link GRAVITY_Y} of sustained acceleration — the "soft all the time"
   * half. The mass lags whatever carries it, so accelerating upward
   * compresses it and dropping away stretches it.
   *
   * Written as the squash it *settles at* rather than as a raw coefficient,
   * because a spring's steady deflection is its drive over its stiffness
   * (`ω₀²`): a plain coefficient would silently change the softness every
   * time {@link RUBBER_BODY.hz} was retuned, and the first value picked that
   * way came out a hundred times too weak to see.
   */
  softness: 0.07,
  /**
   * A frame where the body moved further than this (units) is a cut, not
   * motion — a clip restarting, a Respawn, a knockdown snapping to its start.
   * The frame is skipped and the last velocity kept, the rule the deleted
   * Wobble used and the interpolator still does.
   */
  cutDistance: 0.6,
} as const;

/**
 * The scale a body squashed by `amount` wears — negative squashes and
 * widens, positive stretches and narrows, `0` is exactly the pose it was
 * built at. Pure, so the shape can be checked without a rig.
 */
export const squashScale = (base: THREE.Vector3, amount: number, into: THREE.Vector3): THREE.Vector3 => {
  const k = 1 + Math.max(-0.9, amount);
  const across = 1 / Math.sqrt(k);
  return into.set(base.x * across, base.y * k, base.z * across);
};

interface PendingSquash {
  atMs: number;
  kick: number;
}

/** The soft-body layer for one rig. {@link impact} when one lands, {@link apply} once a frame. */
export class RubberBody {
  private spring: SpringState = { ...SPRING_AT_REST };
  private readonly pending: PendingSquash[] = [];
  private lastMs: number | null = null;
  private readonly base = new THREE.Vector3();
  private readonly next = new THREE.Vector3();
  /** The body's own height last frame, and how fast it was changing — the continuous driver's state. */
  private lastHeight: number | null = null;
  private lastRise = 0;

  constructor(private readonly model: THREE.Object3D) {
    // Whatever the caller sized the model to is what it returns to.
    this.base.copy(model.scale);
  }

  /** How far the body is squashed (negative) or stretched (positive) right now, as a share of its height. */
  get squash(): number {
    return this.spring.angle;
  }

  get ringing(): boolean {
    return this.pending.length > 0 || this.spring.angle !== 0 || this.spring.velocity !== 0;
  }

  /** An Impact landed: the body compresses first, then rings back out through a stretch. */
  impact(magnitude: number, nowMs: number): void {
    if (magnitude <= 0) return;
    this.pending.push({ atMs: nowMs, kick: -magnitude * RUBBER_BODY.gain * 2 * Math.PI * RUBBER_BODY.hz });
  }

  /**
   * One frame of the continuous driver. `height` is how high the body sits in
   * the model's **own** space — never a world height, which this layer's own
   * scale would feed straight back into itself.
   */
  follow(height: number, deltaSeconds: number, softness = 1): void {
    if (deltaSeconds <= 0) return;
    const previous = this.lastHeight;
    this.lastHeight = height;
    if (previous === null) return;
    if (Math.abs(height - previous) > RUBBER_BODY.cutDistance) return;
    const rise = (height - previous) / deltaSeconds;
    const acceleration = (rise - this.lastRise) / deltaSeconds;
    this.lastRise = rise;
    // Drive the spring hard enough that it *settles* at `softness` under one
    // GRAVITY_Y — see the constant. `ω₀²` is the stiffness it has to overcome.
    const stiffness = (2 * Math.PI * RUBBER_BODY.hz) ** 2;
    const drive = -acceleration * (RUBBER_BODY.softness / Math.abs(GRAVITY_Y)) * stiffness * softness;
    this.spring = { angle: this.spring.angle, velocity: this.spring.velocity + drive * deltaSeconds };
  }

  /** Drops the squash and anything queued — a Respawn, a Track swap, a rig handed to the Ragdoll. */
  reset(): void {
    this.pending.length = 0;
    this.spring = { ...SPRING_AT_REST };
    this.lastMs = null;
    this.lastHeight = null;
    this.lastRise = 0;
    this.model.scale.copy(this.base);
  }

  /**
   * Advances the squash and writes the model's scale. `scale` fades the
   * written shape without disturbing a wobble in progress, exactly as
   * `RubberBones.apply` does.
   */
  apply(nowMs: number, scale = 1): void {
    const previousMs = this.lastMs;
    this.lastMs = nowMs;
    const deltaSeconds = previousMs === null ? 0 : Math.min(0.1, Math.max(0, (nowMs - previousMs) / 1000));

    for (const p of this.pending) {
      const due = p.atMs + RUBBER_BODY.delayMs;
      if (previousMs !== null && previousMs < due && due <= nowMs) {
        this.spring = { angle: this.spring.angle, velocity: this.spring.velocity + p.kick };
      }
    }
    for (let i = this.pending.length - 1; i >= 0; i -= 1) {
      if (this.pending[i]!.atMs + RUBBER_BODY.delayMs < nowMs) this.pending.splice(i, 1);
    }

    this.spring = settleSpring(stepSpring(this.spring, deltaSeconds, RUBBER_BODY.hz, RUBBER_BODY.zeta));
    const clamped = Math.max(-RUBBER_BODY.maxSquash, Math.min(RUBBER_BODY.maxSquash, this.spring.angle));
    this.model.scale.copy(squashScale(this.base, clamped * scale, this.next));
  }
}
