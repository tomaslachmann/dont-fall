import * as THREE from "three";
import type { CharacterActions } from "./characterModel.js";

/**
 * What a Floating Character wears over its jump pose (ADR 0077). The two
 * layers and every number here are the fan prototype's own, as the user
 * picked them (2026-09-16):
 *
 * - `Struggle_Air`, looping slowed under the jump piece at partial weight:
 *   legs kicking in the air;
 * - procedural motion on the bones: arms lifting when pushed up and
 *   flapping, legs paddling, the body swaying, the crest fluttering in the
 *   wind, the head looking the way it is carried.
 *
 * Both scale with the Float's own weight (`JumpSequences.floatWeight`), so
 * they come in and go out with it.
 */

/** How much of the pose `Struggle_Air` takes at full Float (the jump piece keeps the rest). */
export const FLOAT_STRUGGLE_SHARE = 0.3;
/** `Struggle_Air`'s pace while Floating (× authored): a drift, not a fight. */
export const FLOAT_STRUGGLE_SPEED = 0.7;

/** The procedural layer at full Float. Angles in radians, rates in Hz. */
export const FLOAT_LIMBS = {
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
  /** How far the body pitches with vertical speed. */
  bodyPitch: 0.15,
  /** How far the crest leans with vertical speed. */
  crestLean: 0.3,
} as const;

/** Vertical speed (units/s) that counts as a full push up or down for the procedural layer. */
const FULL_LIFT_SPEED = 10;

/**
 * Plays `Struggle_Air` under whatever the mixer is drawing, at `weight`
 * (0–1) of {@link FLOAT_STRUGGLE_SHARE}, and stops it at zero. Call it after
 * the frame's crossfade and before `mixer.update`. It leaves the clip alone
 * while the clip is the frame's own `active` action, as it is for a
 * Character held in the air by a Grab.
 */
export const blendFloatStruggle = (
  actions: CharacterActions,
  weight: number,
  active: THREE.AnimationAction | null,
): void => {
  const struggle = actions.struggleAir;
  if (!struggle || struggle === active) return;
  if (weight <= 0) {
    if (struggle.isRunning()) struggle.stop();
    return;
  }
  const share = Math.min(0.95, weight * FLOAT_STRUGGLE_SHARE);
  if (!struggle.isRunning()) {
    struggle.reset();
    struggle.setLoop(THREE.LoopRepeat, Infinity);
    struggle.play();
  }
  struggle.setEffectiveTimeScale(FLOAT_STRUGGLE_SPEED);
  // The mixer normalises weights above one: at `share / (1 − share)`
  // against the pose's own 1, the struggle gets exactly `share` of it.
  struggle.setEffectiveWeight(share / (1 - share));
};

/** Bones by the rig's names; `GLTFLoader` strips the dots (`upper_arm.L` → `upper_armL`). */
const boneOf = (root: THREE.Object3D, name: string): THREE.Object3D | undefined =>
  root.getObjectByName(name.replace(/\./g, "")) ?? root.getObjectByName(name);

const ARMS = ["upper_arm.L", "upper_arm.R"] as const;
const THIGHS = ["thigh.L", "thigh.R"] as const;
const DRIVEN = ["pelvis", "body", "head", "crest.01", "crest.02", ...ARMS, ...THIGHS, "shin.L", "shin.R"] as const;

/**
 * The procedural layer for one rig, written on top of the mixer's pose each
 * frame. The mixer rewrites every bound bone on its next update, so nothing
 * accumulates. Which side each limb is on is measured once, from where it
 * hangs, rather than read off its name: BLIP names limbs from its own point
 * of view (ADR 0071).
 */
export class FloatLimbs {
  private readonly bones = new Map<string, THREE.Object3D>();
  private readonly side = new Map<THREE.Object3D, number>();
  private readonly modelQuaternion = new THREE.Quaternion();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly parentWorld = new THREE.Quaternion();
  private readonly turn = new THREE.Quaternion();

  constructor(private readonly model: THREE.Object3D) {
    for (const name of DRIVEN) {
      const bone = boneOf(model, name);
      if (bone) this.bones.set(name, bone);
    }
    model.updateMatrixWorld(true);
    const toModel = model.matrixWorld.clone().invert();
    for (const name of [...ARMS, ...THIGHS]) {
      const bone = this.bones.get(name);
      if (bone) this.side.set(bone, Math.sign(bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(toModel).x) || 1);
    }
  }

  /** Every bone the layer drives was found — false means a rig this layer does not know. */
  get complete(): boolean {
    return this.bones.size === DRIVEN.length;
  }

  /** Writes the layer at `weight` (0–1) for a Character moving vertically at `verticalVelocity`. */
  apply(weight: number, verticalVelocity: number, nowMs: number): void {
    if (weight <= 0) return;
    const k = weight;
    const s = nowMs / 1000;
    const lift = Math.max(-1, Math.min(1, verticalVelocity / FULL_LIFT_SPEED));
    const L = FLOAT_LIMBS;
    this.model.getWorldQuaternion(this.modelQuaternion);
    this.forward.set(0, 0, 1).applyQuaternion(this.modelQuaternion);
    this.right.set(1, 0, 0).applyQuaternion(this.modelQuaternion);

    for (const name of ARMS) {
      const arm = this.bones.get(name);
      if (!arm) continue;
      const side = this.side.get(arm) ?? 1;
      const phase = side > 0 ? 0 : Math.PI * 0.35;
      const raise = L.armLift * (0.35 + 0.65 * Math.max(0, lift)) + L.armFlap * Math.sin(2 * Math.PI * L.flapHz * s + phase);
      this.rotateWorld(arm, this.forward, side * raise * k);
    }
    for (const name of THIGHS) {
      const thigh = this.bones.get(name);
      if (!thigh) continue;
      const side = this.side.get(thigh) ?? 1;
      const swing = Math.sin(2 * Math.PI * L.paddleHz * s + (side > 0 ? 0 : Math.PI));
      this.rotateWorld(thigh, this.right, L.legPaddle * swing * k);
      this.rotateWorld(this.bones.get(name.replace("thigh", "shin")), this.right, -L.kneeBend * (0.5 + 0.5 * swing) * k);
    }
    const torso = this.bones.get("body") ?? this.bones.get("pelvis");
    this.rotateWorld(torso, this.forward, L.sway * Math.sin(2 * Math.PI * L.swayHz * s) * k);
    this.rotateWorld(torso, this.right, -L.bodyPitch * lift * k);
    this.rotateWorld(this.bones.get("head"), this.right, -L.headLook * lift * k);
    for (const [i, name] of (["crest.01", "crest.02"] as const).entries()) {
      this.rotateWorld(
        this.bones.get(name),
        this.right,
        (L.crestFlutter * Math.sin(2 * Math.PI * L.crestHz * s + i) + L.crestLean * lift) * k,
      );
    }
  }

  /** Turns `bone` by `angle` about a world-space `axis`, keeping its parent where it is. */
  private rotateWorld(bone: THREE.Object3D | undefined, axis: THREE.Vector3, angle: number): void {
    if (!bone?.parent || angle === 0) return;
    // Brings the parent chain's world matrices up to date on its own.
    bone.parent.getWorldQuaternion(this.parentWorld);
    this.turn.setFromAxisAngle(axis, angle);
    // local turn = inverse(parent world) · world turn · parent world
    const local = this.parentWorld.clone().invert().multiply(this.turn).multiply(this.parentWorld);
    bone.quaternion.premultiply(local);
  }
}
