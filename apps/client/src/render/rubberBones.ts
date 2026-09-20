import type { Vec3 } from "@dont-fall/shared";
import * as THREE from "three";
import { boneOf } from "./characterModel.js";

/**
 * The rubber skeleton: what a Character's bones do *after* an Impact (the
 * user's call, 2026-09-20 — "wobble má být po impactu ne random"). A hit, a
 * bump, a knockdown or a hard landing kicks every driven bone into a damped
 * oscillation about the pose the mixer just wrote, and the bones settle back
 * on their own. Nothing drives it between Impacts, so walking is as steady as
 * it is today.
 *
 * It is the missing middle layer between the authored clips (crossfaded,
 * `characterModel.ts`) and the Ragdoll (ADR 0047): the clips have no give and
 * the Ragdoll only exists once you are already down, so a Character that is
 * hit but stays up moves exactly as stiffly as one that was not.
 *
 * Presentation only, on the same terms as `floatPose.ts`'s `FloatLimbs` and
 * the sounds (ADR 0087): written over the mixer's pose each frame, never read
 * by the simulation. Two rules it inherits from that precedent, both load-
 * bearing:
 *
 * - it writes **only bones**, never the model root — the root's yaw is the
 *   Character's replicated `facing` (ADR 0085), so bending it would send a
 *   cosmetic wobble to the server;
 * - it bends away from a **remembered** base pose rather than from whatever
 *   is on the bone, so it can never accumulate.
 *
 * That second rule is not the one `FloatLimbs` states ("the mixer rewrites
 * every bound bone on its next update"). That is false, and cost a day:
 * three.js's `PropertyMixer.apply` compares each accumulated value against
 * the one it last wrote and **skips the write entirely when they match**, so
 * a bone a clip holds still — an arm through `Idle` — is written once and
 * then never again. A layer that premultiplies a delta onto it stacks that
 * delta every frame: one Impact walked BLIP's forearm from 0.61 rad to 1.76
 * and left it there for good, quaternion denormalised to 1.0049. Found by the
 * user, playing the demo. `apply` therefore tells its own last write from a
 * fresh one and re-bases only on the latter.
 *
 * It must stay off while `bones` is non-empty on the snapshot (`Ragdoll` /
 * `GettingUp`): the skeleton is driven from replicated `BoneSnapshot`s then,
 * and `blendGettingUpBones` already owns the way home.
 */

/** How one bone answers an Impact. */
export interface RubberBoneSpec {
  /** Rig node name, dotted as the source file writes it — `boneOf` handles the loader's stripping. */
  name: string;
  /** Share of the Impact this bone takes. Above 1 for the light ends of the body, which whip. */
  gain: number;
  /** How long after the Impact this bone starts to move (ms) — what makes the kick travel up the body instead of hitting it all at once. */
  delayMs: number;
  /** Ring frequency (Hz). Light bones ring faster. */
  hz: number;
  /** Damping ratio, always below 1 so the bone overshoots — the overshoot *is* the rubber. Lower rings longer. */
  zeta: number;
  /** Hard clamp on the deflection either way (radians), so a huge Impact folds the bean instead of turning it inside out. */
  maxAngle: number;
}

/**
 * The body, ordered as the kick travels through it: hips first and barely,
 * then the torso, then the head and crest, which whip hardest and ring
 * longest. Limbs trail the torso.
 *
 * Every number here is a first guess — no shader or rig in this repo has ever
 * been rasterised by a test, so none of this has been looked at. `rubber.html`
 * exists to find the real ones (it drives all six knobs live).
 */
export const RUBBER_BONES: readonly RubberBoneSpec[] = [
  { name: "pelvis", gain: 0.25, delayMs: 0, hz: 3.0, zeta: 0.55, maxAngle: 0.18 },
  { name: "body", gain: 0.6, delayMs: 20, hz: 2.6, zeta: 0.5, maxAngle: 0.35 },
  { name: "head", gain: 1.0, delayMs: 55, hz: 3.4, zeta: 0.38, maxAngle: 0.5 },
  { name: "crest.01", gain: 1.3, delayMs: 75, hz: 5.0, zeta: 0.3, maxAngle: 0.6 },
  { name: "crest.02", gain: 1.6, delayMs: 95, hz: 6.0, zeta: 0.26, maxAngle: 0.7 },
  { name: "upper_arm.L", gain: 1.1, delayMs: 45, hz: 3.8, zeta: 0.35, maxAngle: 0.7 },
  { name: "upper_arm.R", gain: 1.1, delayMs: 45, hz: 3.8, zeta: 0.35, maxAngle: 0.7 },
  { name: "forearm.L", gain: 1.35, delayMs: 70, hz: 4.6, zeta: 0.3, maxAngle: 0.8 },
  { name: "forearm.R", gain: 1.35, delayMs: 70, hz: 4.6, zeta: 0.3, maxAngle: 0.8 },
  { name: "thigh.L", gain: 0.7, delayMs: 35, hz: 3.2, zeta: 0.45, maxAngle: 0.45 },
  { name: "thigh.R", gain: 0.7, delayMs: 35, hz: 3.2, zeta: 0.45, maxAngle: 0.45 },
  { name: "shin.L", gain: 0.9, delayMs: 60, hz: 4.2, zeta: 0.35, maxAngle: 0.55 },
  { name: "shin.R", gain: 0.9, delayMs: 60, hz: 4.2, zeta: 0.35, maxAngle: 0.55 },
];

/** The longest any bone waits before it answers — how long a fired Impact has to be kept around. */
export const RUBBER_MAX_DELAY_MS = RUBBER_BONES.reduce((max, b) => Math.max(max, b.delayMs), 0);

/** Radians of deflection a full-strength (magnitude 1) Impact kicks a gain-1 bone to, near enough. */
export const RUBBER_IMPACT_ANGLE = 0.55;

/**
 * Deflection (rad) and rate (rad/s) below which a bone is called still and
 * snapped to exact rest. An exponential decay never reaches zero in floating
 * point, so without this the layer would report itself ringing forever and a
 * caller could never skip the write. The same "flat epsilon" the netcode's
 * own decaying offset ends on (`CAPSULE_ERR_FLAT_EPSILON_M`). 1e-4 rad is
 * six thousandths of a degree.
 */
export const RUBBER_REST_ANGLE = 1e-4;
export const RUBBER_REST_VELOCITY = 1e-3;

/** One axis of one bone: its deflection (rad) and the rate it is moving at (rad/s). */
export interface SpringState {
  angle: number;
  velocity: number;
}

export const SPRING_AT_REST: Readonly<SpringState> = Object.freeze({ angle: 0, velocity: 0 });

/**
 * One frame of a damped harmonic oscillator, in closed form.
 *
 * Solved rather than integrated because the demo and the game both run at
 * whatever the display gives them: a Euler or lerp step changes its own decay
 * and frequency with the frame rate, so the same Impact would ring
 * differently at 60 and 144 Hz — and a spring, unlike the exponential eases
 * this repo uses elsewhere (`nextModelYaw`, ADR 0109's follow), *amplifies*
 * that error instead of damping it.
 *
 * `zeta` is clamped below 1: an overshoot is the whole point, and the
 * underdamped solution is singular at critical damping.
 */
export const stepSpring = (state: SpringState, deltaSeconds: number, hz: number, zeta: number): SpringState => {
  if (deltaSeconds <= 0 || hz <= 0) return state;
  const z = Math.min(0.999, Math.max(0, zeta));
  const w0 = 2 * Math.PI * hz;
  const wd = w0 * Math.sqrt(1 - z * z);
  const decay = Math.exp(-z * w0 * deltaSeconds);
  const c = Math.cos(wd * deltaSeconds);
  const s = Math.sin(wd * deltaSeconds);
  const a = state.angle;
  const b = (state.velocity + z * w0 * a) / wd;
  return {
    angle: decay * (a * c + b * s),
    velocity: decay * ((b * wd - z * w0 * a) * c - (a * wd + z * w0 * b) * s),
  };
};

/** An Impact as the layer takes it: which way the body was shoved, and how hard. */
export interface RubberImpact {
  /**
   * World-space direction the body was shoved — the same vector the Impact
   * itself carries. Need not be normalised; only its horizontal part is read.
   */
  direction: Vec3;
  /** How hard, 0–1. `RUBBER_IMPACT_MAGNITUDE` names the ones the game already detects. */
  magnitude: number;
}

/**
 * How hard each Impact this game already detects shoves the skeleton, on the
 * layer's own 0–1 scale. Deliberately the same ordering, and near enough the
 * same weights, as the screen shake's (`cameraShake.ts`, ADR 0110): the jolt
 * and the wobble answer the same events, so one of them reading a knockdown
 * as harder than a Hit while the other did not would be a bug wearing two
 * hats.
 */
export const RUBBER_IMPACT_MAGNITUDE = {
  knockdownHeavy: 1,
  knockdown: 0.75,
  hitTaken: 0.55,
  bump: 0.3,
  hardLanding: 0.5,
} as const;

export type RubberImpactKind = keyof typeof RUBBER_IMPACT_MAGNITUDE;

interface PendingImpact {
  /** When it landed, on the caller's own clock (ms). */
  atMs: number;
  /** Deflection the Impact asks a gain-1 bone for, about the rig's right axis (rad). */
  pitch: number;
  /** …and about its forward axis. */
  roll: number;
}

interface DrivenBone {
  spec: RubberBoneSpec;
  bone: THREE.Object3D;
  pitch: SpringState;
  roll: SpringState;
  /** The pose the mixer last wrote — what this bone bends away from. */
  base: THREE.Quaternion;
  /** What the layer left on the bone last frame, so a mixer write can be told from its own. */
  written: THREE.Quaternion;
  /** False until {@link RubberBones.apply} has read a base at least once. */
  seeded: boolean;
}

/**
 * Turns an Impact's world direction into the two deflections a bone trailing
 * behind it takes, in the rig's own frame.
 *
 * The signs are derived, not picked. `forward` is the rig's local +Z and
 * `right` its +X (`floatPose.ts` reads them the same way), so a positive turn
 * about `right` tilts a bone's up-axis toward +Z (forward), and a positive
 * turn about `forward` tilts it toward −X (left). A bone *trails* the shove —
 * shoved from behind, the feet go first and the head goes back — so a shove
 * along +forward wants a negative turn about `right`, and a shove along
 * +right wants a positive turn about `forward`.
 */
export const impactDeflection = (
  impact: RubberImpact,
  forward: Vec3,
  right: Vec3,
): { pitch: number; roll: number } => {
  const d = impact.direction;
  const length = Math.hypot(d.x, d.z);
  if (length === 0 || impact.magnitude === 0) return { pitch: 0, roll: 0 };
  const kick = impact.magnitude * RUBBER_IMPACT_ANGLE;
  const along = (d.x * forward.x + d.z * forward.z) / length;
  const across = (d.x * right.x + d.z * right.z) / length;
  return { pitch: -along * kick, roll: across * kick };
};

const clamp = (v: number, limit: number): number => (v < -limit ? -limit : v > limit ? limit : v);

/** A spring too small to see is a spring at rest — see {@link RUBBER_REST_ANGLE}. */
export const settleSpring = (state: SpringState): SpringState =>
  Math.abs(state.angle) < RUBBER_REST_ANGLE && Math.abs(state.velocity) < RUBBER_REST_VELOCITY
    ? { angle: 0, velocity: 0 }
    : state;

/**
 * The layer for one rig. Built once beside the mixer, like `FloatLimbs`;
 * {@link impact} on the frame an Impact is detected, {@link apply} after
 * every `mixer.update`.
 */
export class RubberBones {
  private readonly driven: DrivenBone[] = [];
  private readonly pending: PendingImpact[] = [];
  private lastMs: number | null = null;

  private readonly modelQuaternion = new THREE.Quaternion();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly parentWorld = new THREE.Quaternion();
  private readonly turn = new THREE.Quaternion();
  private readonly local = new THREE.Quaternion();
  private readonly specCount: number;

  constructor(
    private readonly model: THREE.Object3D,
    specs: readonly RubberBoneSpec[] = RUBBER_BONES,
  ) {
    for (const spec of specs) {
      const bone = boneOf(model, spec.name);
      if (bone)
        this.driven.push({
          spec,
          bone,
          pitch: { ...SPRING_AT_REST },
          roll: { ...SPRING_AT_REST },
          base: new THREE.Quaternion(),
          written: new THREE.Quaternion(),
          seeded: false,
        });
    }
    this.specCount = specs.length;
  }

  /** Every bone the layer drives was found — false means a rig this layer does not know. */
  get complete(): boolean {
    return this.driven.length === this.specCount;
  }

  /** Whether anything is still moving — so a caller can skip the write entirely on a rig at rest. */
  get ringing(): boolean {
    if (this.pending.length > 0) return true;
    return this.driven.some(
      (d) => d.pitch.angle !== 0 || d.pitch.velocity !== 0 || d.roll.angle !== 0 || d.roll.velocity !== 0,
    );
  }

  /**
   * An Impact landed. Queued rather than applied, because each bone answers
   * it at its own `delayMs` — that stagger is what makes one shove travel up
   * the body instead of twitching all of it at once.
   */
  impact(impact: RubberImpact, nowMs: number): void {
    this.model.getWorldQuaternion(this.modelQuaternion);
    this.forward.set(0, 0, 1).applyQuaternion(this.modelQuaternion);
    this.right.set(1, 0, 0).applyQuaternion(this.modelQuaternion);
    const { pitch, roll } = impactDeflection(
      impact,
      { x: this.forward.x, y: 0, z: this.forward.z },
      { x: this.right.x, y: 0, z: this.right.z },
    );
    if (pitch === 0 && roll === 0) return;
    this.pending.push({ atMs: nowMs, pitch, roll });
  }

  /** Drops every ring and every queued Impact — for a Respawn, a Track swap, or a rig going into the Ragdoll's hands. */
  reset(): void {
    this.pending.length = 0;
    this.lastMs = null;
    for (const d of this.driven) {
      d.pitch = { ...SPRING_AT_REST };
      d.roll = { ...SPRING_AT_REST };
      // The next frame re-reads the pose rather than trusting one taken
      // before whatever the reset was for.
      d.seeded = false;
    }
  }

  /**
   * Advances every spring and writes the result over the mixer's pose. Call
   * it after `mixer.update` — before it, and the mixer would overwrite the
   * whole layer on the same frame.
   *
   * `scale` is a plain multiplier on the written angle (not on the spring),
   * so a caller can fade the layer in or out — or the demo can take it to
   * zero — without disturbing a ring in progress.
   */
  apply(nowMs: number, scale = 1): void {
    const previousMs = this.lastMs;
    this.lastMs = nowMs;
    // A first frame, or a tab that was in the background, has no honest
    // delta to advance by — the same "skip a discontinuity" rule the
    // interpolator and the deleted Wobble both used.
    const deltaSeconds = previousMs === null ? 0 : Math.min(0.1, Math.max(0, (nowMs - previousMs) / 1000));

    if (this.pending.length > 0) {
      this.model.getWorldQuaternion(this.modelQuaternion);
      this.forward.set(0, 0, 1).applyQuaternion(this.modelQuaternion);
      this.right.set(1, 0, 0).applyQuaternion(this.modelQuaternion);
    }

    for (const d of this.driven) {
      // Anything whose delay elapsed between the last frame and this one
      // kicks now. Edge-detected on time rather than counted off per bone, so
      // a dropped frame delivers the kick late instead of losing it.
      for (const p of this.pending) {
        const due = p.atMs + d.spec.delayMs;
        if (previousMs !== null && previousMs < due && due <= nowMs) {
          const kick = d.spec.gain * 2 * Math.PI * d.spec.hz;
          d.pitch = { angle: d.pitch.angle, velocity: d.pitch.velocity + p.pitch * kick };
          d.roll = { angle: d.roll.angle, velocity: d.roll.velocity + p.roll * kick };
        }
      }
      d.pitch = settleSpring(stepSpring(d.pitch, deltaSeconds, d.spec.hz, d.spec.zeta));
      d.roll = settleSpring(stepSpring(d.roll, deltaSeconds, d.spec.hz, d.spec.zeta));

      // Anything on the bone that this layer did not put there last frame is
      // a fresh pose from the mixer, and becomes what the springs bend away
      // from. Equality is exact on purpose: `written` was copied off the bone
      // after the last write, so an untouched bone matches it bit for bit.
      if (!d.seeded || !d.bone.quaternion.equals(d.written)) {
        d.base.copy(d.bone.quaternion);
        d.seeded = true;
      }
      d.bone.quaternion.copy(d.base);

      const pitch = clamp(d.pitch.angle, d.spec.maxAngle) * scale;
      const roll = clamp(d.roll.angle, d.spec.maxAngle) * scale;
      this.rotateWorld(d.bone, this.right, pitch);
      this.rotateWorld(d.bone, this.forward, roll);
      d.bone.quaternion.normalize();
      d.written.copy(d.bone.quaternion);
    }

    // Kept only until the last bone has had its chance at it.
    for (let i = this.pending.length - 1; i >= 0; i -= 1) {
      if (this.pending[i]!.atMs + RUBBER_MAX_DELAY_MS < nowMs) this.pending.splice(i, 1);
    }
  }

  /** Turns `bone` by `angle` about a world-space `axis`, keeping its parent where it is (`floatPose.ts`'s own move). */
  private rotateWorld(bone: THREE.Object3D, axis: THREE.Vector3, angle: number): void {
    if (!bone.parent || angle === 0) return;
    bone.parent.getWorldQuaternion(this.parentWorld);
    this.turn.setFromAxisAngle(axis, angle);
    this.local.copy(this.parentWorld).invert().multiply(this.turn).multiply(this.parentWorld);
    bone.quaternion.premultiply(this.local);
  }
}
