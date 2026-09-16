// PROTOTYPE — how BLIP moves while an updraft holds it up. Today's jump sequence
// (apps/client/src/render/jumpSequence.ts) only ever moves forward, so a Character bobbing in an
// updraft for seconds freezes on one frame — whichever the playhead reached first. Two answers:
//
// HOLD — round one's hybrid: the playhead rests on the apex; Struggle_Air loops over it at partial
//        weight; procedural limbs on top.
// LOOP — the jump's own air pieces become the loop. While floating, the playhead stops being a
//        forward-only clock and becomes a function of vertical speed, both ways: pushed up it shows
//        Rise, weightless it shows Apex, sinking it shows Fall. The updraft's bob (±10 u/s, about
//        a 2 s period with the fan def's numbers) therefore walks it back and forth across Rise →
//        Apex → Fall on its own, paced by the physics rather than a timer. A slow "breathe" on top
//        keeps it alive when the speed holds steady; the Struggle_Air and procedural layers are the
//        same as HOLD's, each with its own slider so it can be zeroed to see what it adds.
//
// Floating is latched: entering an updraft airborne starts it, and it only lets go after
// `releaseMs` outside every updraft (or on landing). The bob carries the body a couple of units
// above the column's top every cycle, and without the latch the pose would drop out and back in
// on every bob.
//
// The fall afterwards is paced to the floor actually below (the game would raycast), not the
// floor jumped from.
import { GRAVITY_Y, JUMP_VELOCITY } from "@dont-fall/shared";
import * as THREE from "three";
import type { CharacterActions } from "../../src/render/characterModel.js";
import {
  LANDING_MIN_AIRBORNE_MS,
  LANDING_MOVING_RATE,
  MAX_PLAYBACK_RATE,
  RELAUNCH_KICK,
  TAKEOFF_MIN_SPEED,
  jumpPoseAt,
  type JumpTimeline,
} from "../../src/render/jumpSequence.js";

export type FloatMode = "hold" | "loop";

export const floatTuning = {
  releaseMs: 1000,
  // LOOP: which stretch of the air pieces the loop walks, as a share of liftoff → brace
  // (BLIP: 0 = end of Jump_Start, 0.55 = the apex, 1 = just before the legs brace).
  loopFrom: 0.15,
  loopTo: 0.9,
  followSpeed: 1,
  breathe: 0.06,
  breatheHz: 0.7,
  settle: 7,
  // layers, both modes
  struggleWeight: 0.3,
  struggleSpeed: 0.7,
  blendIn: 0.35,
  blendOut: 0.3,
  armLift: 0.6,
  armFlap: 0.25,
  flapHz: 1.3,
  legPaddle: 0.35,
  paddleHz: 1.1,
  kneeBend: 0.4,
  sway: 0.1,
  swayHz: 0.45,
  crestFlutter: 0.35,
  crestHz: 6,
  headLook: 0.2,
};

/** Signed ranges on purpose: a limb that turns the wrong way is fixed by dragging past zero. */
export const FLOAT_RANGES: Record<keyof typeof floatTuning, [number, number]> = {
  releaseMs: [0, 2500],
  loopFrom: [0, 1],
  loopTo: [0, 1],
  followSpeed: [0, 1],
  breathe: [0, 0.3],
  breatheHz: [0.1, 3],
  settle: [1, 30],
  struggleWeight: [0, 1],
  struggleSpeed: [0.1, 1.5],
  blendIn: [0.05, 1],
  blendOut: [0.05, 1],
  armLift: [-1.6, 1.6],
  armFlap: [-1, 1],
  flapHz: [0.2, 4],
  legPaddle: [-1.2, 1.2],
  paddleHz: [0.2, 3],
  kneeBend: [-1.2, 1.2],
  sway: [0, 0.5],
  swayHz: [0.1, 2],
  crestFlutter: [0, 1],
  crestHz: [1, 12],
  headLook: [-0.8, 0.8],
};

/** Which sliders a mode uses. */
export const FLOAT_KEYS: Record<FloatMode, readonly (keyof typeof floatTuning)[]> = {
  hold: (Object.keys(floatTuning) as (keyof typeof floatTuning)[]).filter(
    (k) => !["loopFrom", "loopTo", "followSpeed", "breathe", "breatheHz", "settle"].includes(k),
  ),
  loop: Object.keys(floatTuning) as (keyof typeof floatTuning)[],
};

export interface FloatFrame {
  grounded: boolean;
  verticalVelocity: number;
  /** Feet above the floor directly below. */
  heightAboveFloor: number;
  /** Inside an updraft Volume this frame. */
  inUpdraft: boolean;
  moving: boolean;
  deltaSeconds: number;
  nowMs: number;
}

const approach = (value: number, target: number, step: number): number =>
  value < target ? Math.min(target, value + step) : Math.max(target, value - step);

const secondsToFloor = (height: number, speed: number): number => {
  const g = -GRAVITY_Y;
  const discriminant = speed * speed + 2 * g * height;
  return discriminant < 0 ? 0 : (speed + Math.sqrt(discriminant)) / g;
};

/** Bones by the rig's names; GLTFLoader strips the dots (`upper_arm.L` → `upper_armL`). */
const bone = (root: THREE.Object3D, name: string): THREE.Object3D | undefined =>
  root.getObjectByName(name) ?? root.getObjectByName(name.replace(/\./g, ""));

export class FloatAnimator {
  private playhead: number | null = null;
  private airborne = false;
  private leftGroundAtMs = 0;
  private lastVelocity = 0;
  private lastInUpdraftMs = -Infinity;
  /** Latched: held up by an updraft (see the file header). */
  floating = false;
  /** 0 → 1 as the updraft takes the body. */
  weight = 0;
  private readonly weights = new Map<THREE.AnimationAction, number>();
  private readonly all: THREE.AnimationAction[];
  private readonly bones: Record<string, THREE.Object3D | undefined>;
  private readonly side = new Map<THREE.Object3D, number>();

  constructor(
    private readonly mode: FloatMode,
    private readonly model: THREE.Object3D,
    private readonly actions: CharacterActions,
    private readonly timeline: JumpTimeline,
  ) {
    this.all = [
      actions.idle,
      actions.walk,
      actions.jumpStart,
      actions.jumpRise,
      actions.jumpApex,
      actions.jumpFall,
      actions.jumpLand,
      actions.struggleAir,
    ].filter((a): a is THREE.AnimationAction => a !== null);
    for (const action of this.all) {
      action.reset().play();
      action.setEffectiveWeight(0);
      this.weights.set(action, 0);
    }
    for (const piece of [actions.jumpStart, actions.jumpRise, actions.jumpApex, actions.jumpFall, actions.jumpLand]) {
      if (piece) piece.paused = true;
    }
    actions.struggleAir?.setLoop(THREE.LoopRepeat, Infinity);
    const names = ["pelvis", "body", "head", "crest.01", "crest.02", "upper_arm.L", "forearm.L", "upper_arm.R", "forearm.R", "thigh.L", "shin.L", "thigh.R", "shin.R"];
    this.bones = Object.fromEntries(names.map((n) => [n, bone(model, n)]));
    // Which side each limb is on, from where it sits at bind: +1 on the model's +X.
    model.updateMatrixWorld(true);
    const inverse = model.matrixWorld.clone().invert();
    for (const n of ["upper_arm.L", "upper_arm.R", "thigh.L", "thigh.R"]) {
      const b = this.bones[n];
      if (b) this.side.set(b, Math.sign(b.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse).x) || 1);
    }
  }

  /** Bones this rig is missing, for the state panel. */
  get missingBones(): string[] {
    return Object.entries(this.bones)
      .filter(([, b]) => !b)
      .map(([n]) => n);
  }

  /** Where on the timeline LOOP wants the playhead for `speed` this frame. */
  private loopTarget(speed: number, nowMs: number): number {
    const t = this.timeline;
    const span = t.brace - t.liftoff;
    const from = t.liftoff + Math.min(floatTuning.loopFrom, floatTuning.loopTo) * span;
    const to = t.liftoff + Math.max(floatTuning.loopFrom, floatTuning.loopTo) * span;
    const apex = Math.min(to, Math.max(from, t.apex));
    // The authored arc is a parabola, so clip time is linear in vertical speed — the same
    // mapping jumpSequence's entry point uses, here allowed to run both ways.
    const share = Math.max(-1, Math.min(1, speed / JUMP_VELOCITY)) * floatTuning.followSpeed;
    const bySpeed = share >= 0 ? apex - share * (apex - from) : apex - share * (to - apex);
    const breathe = floatTuning.breathe * Math.sin(2 * Math.PI * floatTuning.breatheHz * (nowMs / 1000));
    return Math.min(to, Math.max(from, bySpeed + breathe));
  }

  /** Returns a short description of what it did, for the state panel. */
  frame(frame: FloatFrame, mixer: THREE.AnimationMixer): string {
    const t = this.timeline;
    const speed = frame.verticalVelocity;
    const dt = frame.deltaSeconds;

    // --- the latch ---
    if (frame.inUpdraft) this.lastInUpdraftMs = frame.nowMs;
    if (frame.grounded) this.floating = false;
    else if (frame.inUpdraft) this.floating = true;
    else if (frame.nowMs - this.lastInUpdraftMs > floatTuning.releaseMs) this.floating = false;

    // --- the playhead ---
    if (frame.grounded) {
      if (this.playhead !== null) {
        if (this.airborne) {
          if (frame.nowMs - this.leftGroundAtMs < LANDING_MIN_AIRBORNE_MS) this.playhead = null;
          this.airborne = false;
        }
        if (this.playhead !== null) {
          const rate = this.playhead < t.brace ? MAX_PLAYBACK_RATE : frame.moving ? LANDING_MOVING_RATE : 1;
          this.playhead += rate * dt;
          if (this.playhead >= t.end) this.playhead = null;
        }
      }
    } else if (this.playhead === null || !this.airborne || (!this.floating && speed - this.lastVelocity >= RELAUNCH_KICK)) {
      const onArc = t.apex - (speed / JUMP_VELOCITY) * (t.apex - t.liftoff);
      this.playhead = speed >= TAKEOFF_MIN_SPEED ? 0 : Math.min(t.brace, Math.max(t.liftoff, onArc));
      if (!this.airborne) this.leftGroundAtMs = frame.nowMs;
      this.airborne = true;
    } else if (this.floating && this.playhead >= t.liftoff) {
      // (Before liftoff the push-off finishes at today's pace, in the branch below.)
      if (this.mode === "hold") {
        this.playhead = approach(this.playhead, t.apex, dt * (this.playhead < t.apex ? MAX_PLAYBACK_RATE : 1));
      } else {
        const target = this.loopTarget(speed, frame.nowMs);
        this.playhead += (target - this.playhead) * (1 - Math.exp(-floatTuning.settle * dt));
      }
    } else {
      const target = speed > 0 ? t.apex : t.brace;
      const secondsLeft = speed > 0 ? speed / -GRAVITY_Y : secondsToFloor(frame.heightAboveFloor, speed);
      const rate = secondsLeft > 0 ? Math.min(MAX_PLAYBACK_RATE, (target - this.playhead) / secondsLeft) : 1;
      this.playhead = Math.max(this.playhead, Math.min(target, this.playhead + Math.max(0, rate) * dt));
    }
    this.lastVelocity = speed;

    // --- the float weight ---
    const blend = this.floating ? floatTuning.blendIn : floatTuning.blendOut;
    this.weight = approach(this.weight, this.floating ? 1 : 0, dt / Math.max(0.01, blend));

    // --- clip weights, all summing to one ---
    const targets = new Map<THREE.AnimationAction, number>();
    const pose = this.playhead === null ? null : jumpPoseAt(this.playhead, this.actions);
    const struggle = this.actions.struggleAir && pose ? this.weight * floatTuning.struggleWeight : 0;
    if (pose) {
      pose.action.time = pose.time;
      targets.set(pose.action, 1 - struggle);
      if (this.actions.struggleAir) targets.set(this.actions.struggleAir, struggle);
    } else {
      const loco = frame.moving ? this.actions.walk : this.actions.idle;
      if (loco) targets.set(loco, 1);
    }
    if (this.actions.struggleAir) this.actions.struggleAir.timeScale = floatTuning.struggleSpeed;
    // Neighbouring pieces meet pose for pose, so a piece change mid-loop swaps at once; only a
    // change of kind (air ↔ ground) fades.
    const pieceSwap = pose !== null && [...this.weights.entries()].some(([a, w]) => w > 0.5 && a !== pose.action && this.isJumpPiece(a));
    const fadeStep = dt / 0.1;
    for (const action of this.all) {
      const target = targets.get(action) ?? 0;
      const current = this.weights.get(action) ?? 0;
      const w = pieceSwap && this.isJumpPiece(action) ? target : approach(current, target, fadeStep);
      this.weights.set(action, w);
      action.setEffectiveWeight(w);
    }
    mixer.update(dt);

    // --- procedural motion on top, scaled by the float weight ---
    if (this.weight > 0.001) this.procedural(frame);

    const piece = pose ? pose.action.getClip().name : "locomotion";
    return (
      `playhead ${this.playhead === null ? "—" : this.playhead.toFixed(3)} (${piece})\n` +
      `floating ${this.floating}  weight ${this.weight.toFixed(2)}  struggle ${struggle.toFixed(2)}`
    );
  }

  private isJumpPiece(action: THREE.AnimationAction): boolean {
    const a = this.actions;
    return action === a.jumpStart || action === a.jumpRise || action === a.jumpApex || action === a.jumpFall || action === a.jumpLand;
  }

  private rotateWorld(target: THREE.Object3D | undefined, axis: THREE.Vector3, angle: number): void {
    if (!target?.parent || angle === 0) return;
    const parent = target.parent.getWorldQuaternion(new THREE.Quaternion());
    const turn = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    const local = parent.clone().invert().multiply(turn).multiply(parent);
    target.quaternion.premultiply(local);
  }

  private procedural(frame: FloatFrame): void {
    const k = this.weight;
    const s = frame.nowMs / 1000;
    const lift = Math.max(-1, Math.min(1, frame.verticalVelocity / 10));
    const model = new THREE.Quaternion();
    this.model.getWorldQuaternion(model);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(model);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(model);
    const b = this.bones;
    const T = floatTuning;

    for (const name of ["upper_arm.L", "upper_arm.R"]) {
      const arm = b[name];
      if (!arm) continue;
      const side = this.side.get(arm) ?? 1;
      const phase = side > 0 ? 0 : Math.PI * 0.35;
      const raise = T.armLift * (0.35 + 0.65 * Math.max(0, lift)) + T.armFlap * Math.sin(2 * Math.PI * T.flapHz * s + phase);
      this.rotateWorld(arm, forward, side * raise * k);
    }
    for (const name of ["thigh.L", "thigh.R"]) {
      const thigh = b[name];
      if (!thigh) continue;
      const side = this.side.get(thigh) ?? 1;
      const swing = Math.sin(2 * Math.PI * T.paddleHz * s + (side > 0 ? 0 : Math.PI));
      this.rotateWorld(thigh, right, T.legPaddle * swing * k);
      const shin = b[name.replace("thigh", "shin")];
      this.rotateWorld(shin, right, -T.kneeBend * (0.5 + 0.5 * swing) * k);
    }
    this.rotateWorld(b["body"] ?? b["pelvis"], forward, T.sway * Math.sin(2 * Math.PI * T.swayHz * s) * k);
    this.rotateWorld(b["body"] ?? b["pelvis"], right, -0.15 * lift * k);
    this.rotateWorld(b["head"], right, -T.headLook * lift * k);
    for (const [i, name] of ["crest.01", "crest.02"].entries()) {
      this.rotateWorld(b[name], right, (T.crestFlutter * Math.sin(2 * Math.PI * T.crestHz * s + i) + 0.3 * lift) * k);
    }
  }
}
