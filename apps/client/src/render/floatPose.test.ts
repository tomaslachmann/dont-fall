import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { CharacterActions } from "./characterModel.js";
import { FLOAT_STRUGGLE_SHARE, FLOAT_STRUGGLE_SPEED, FloatLimbs, blendFloatStruggle } from "./floatPose.js";

const actionsWith = (struggleAir: THREE.AnimationAction | null): CharacterActions => ({
  idle: null, walk: null, run: null, sprint: null,
  jumpStart: null, jumpRise: null, jumpApex: null, jumpFall: null, jumpLand: null,
  punch: null, hitReact: null,
  ko: { F: null, FL: null, FR: null, B: null, BL: null, BR: null },
  getUp: { F: null, FL: null, FR: null, B: null, BL: null, BR: null },
  death: { F: null, FL: null, FR: null, B: null, BL: null, BR: null },
  grabReach: null, grabPull: null, grabHold: null, grabDropOut: null,
  struggleHeld: null, struggleAir, wobble: null, wobbleWalk: null,
});

const struggleRig = () => {
  const mixer = new THREE.AnimationMixer(new THREE.Object3D());
  const clip = new THREE.AnimationClip("Struggle_Air", 1.2, [new THREE.VectorKeyframeTrack(".position", [0, 1.2], [0, 0, 0, 0, 1, 0])]);
  const struggle = mixer.clipAction(clip);
  return { mixer, struggle, actions: actionsWith(struggle) };
};

describe("blendFloatStruggle", () => {
  it("plays Struggle_Air slowed, taking its share of the pose at full Float", () => {
    const { struggle, actions } = struggleRig();
    blendFloatStruggle(actions, 1, null);
    expect(struggle.isRunning()).toBe(true);
    expect(struggle.getEffectiveTimeScale()).toBeCloseTo(FLOAT_STRUGGLE_SPEED);
    const w = struggle.getEffectiveWeight();
    // Against the pose's own weight of 1, the mixer normalises this to the share.
    expect(w / (1 + w)).toBeCloseTo(FLOAT_STRUGGLE_SHARE);
    expect(struggle.loop).toBe(THREE.LoopRepeat);
  });

  it("scales with the Float's weight, and stops at zero", () => {
    const { struggle, actions } = struggleRig();
    blendFloatStruggle(actions, 0.5, null);
    const half = struggle.getEffectiveWeight();
    expect(half / (1 + half)).toBeCloseTo(FLOAT_STRUGGLE_SHARE * 0.5);
    blendFloatStruggle(actions, 0, null);
    expect(struggle.isRunning()).toBe(false);
  });

  it("keeps running from where it was rather than restarting every frame", () => {
    const { mixer, struggle, actions } = struggleRig();
    blendFloatStruggle(actions, 1, null);
    mixer.update(0.5);
    blendFloatStruggle(actions, 1, null);
    expect(struggle.time).toBeGreaterThan(0);
  });

  it("leaves the clip alone while it is the frame's own action — a Grab's struggle in the air", () => {
    const { struggle, actions } = struggleRig();
    struggle.play();
    struggle.setEffectiveWeight(1);
    blendFloatStruggle(actions, 0, struggle);
    expect(struggle.isRunning()).toBe(true);
    blendFloatStruggle(actions, 1, struggle);
    expect(struggle.getEffectiveWeight()).toBe(1);
  });

  it("does nothing for a rig without the clip", () => {
    expect(() => blendFloatStruggle(actionsWith(null), 1, null)).not.toThrow();
  });
});

/** A rig laid out like BLIP's, names as the loader produces them, limbs labelled from the rig's own point of view. */
const blipLikeRig = () => {
  const model = new THREE.Group();
  const node = (name: string, parent: THREE.Object3D, x = 0, y = 0): THREE.Object3D => {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.set(x, y, 0);
    parent.add(bone);
    return bone;
  };
  const pelvis = node("pelvis", model, 0, 0.6);
  const body = node("body", pelvis, 0, 0.2);
  const head = node("head", body, 0, 0.5);
  node("crest01", head, 0, 0.3);
  node("crest02", head, 0, 0.4);
  const armL = node("upper_armL", body, -0.7, 0.2);
  const armR = node("upper_armR", body, 0.7, 0.2);
  const thighL = node("thighL", pelvis, -0.3, -0.1);
  const thighR = node("thighR", pelvis, 0.3, -0.1);
  node("shinL", thighL, 0, -0.3);
  node("shinR", thighR, 0, -0.3);
  return { model, armL, armR, thighL, head };
};

describe("FloatLimbs", () => {
  it("finds every bone it drives on a BLIP-shaped rig", () => {
    expect(new FloatLimbs(blipLikeRig().model).complete).toBe(true);
    expect(new FloatLimbs(new THREE.Group()).complete).toBe(false);
  });

  it("draws nothing at zero weight", () => {
    const { model, armL } = blipLikeRig();
    const before = armL.quaternion.clone();
    new FloatLimbs(model).apply(0, 5, 1234);
    expect(armL.quaternion.equals(before)).toBe(true);
  });

  it("lifts the arms outward, each to its own side, harder when pushed up", () => {
    const { model, armL, armR } = blipLikeRig();
    const limbs = new FloatLimbs(model);
    // At t = 0 the flap is at zero on the +X arm; only the lift acts there.
    limbs.apply(1, 10, 0);
    const turnR = new THREE.Euler().setFromQuaternion(armR.quaternion).z;
    const turnL = new THREE.Euler().setFromQuaternion(armL.quaternion).z;
    // Opposite turns about forward: both arms go out and up, mirrored.
    expect(Math.sign(turnR)).toBe(1);
    expect(Math.sign(turnL)).toBe(-1);

    const calm = blipLikeRig();
    new FloatLimbs(calm.model).apply(1, 0, 0);
    expect(Math.abs(new THREE.Euler().setFromQuaternion(calm.armR.quaternion).z)).toBeLessThan(Math.abs(turnR));
  });

  it("follows the model's own turn: the same pose in the model's frame, whichever way it faces", () => {
    const straight = blipLikeRig();
    const turned = blipLikeRig();
    turned.model.rotation.y = 1.2;
    new FloatLimbs(straight.model).apply(1, 4, 700);
    new FloatLimbs(turned.model).apply(1, 4, 700);
    for (const bone of ["thighL", "head"] as const) {
      const a = straight[bone].quaternion;
      const b = turned[bone].quaternion;
      expect(a.angleTo(b)).toBeLessThan(1e-9);
    }
  });

  it("is written over the pose each frame, never accumulated, once the mixer resets it", () => {
    const { model, head } = blipLikeRig();
    const limbs = new FloatLimbs(model);
    const bones: THREE.Object3D[] = [];
    model.traverse((object) => {
      if (object !== model) bones.push(object);
    });
    const rest = bones.map((bone) => bone.quaternion.clone());
    limbs.apply(1, -6, 300);
    const once = head.quaternion.clone();
    // What the mixer does on its next update: every bound bone back to the clip's pose.
    bones.forEach((bone, i) => bone.quaternion.copy(rest[i]!));
    limbs.apply(1, -6, 300);
    expect(head.quaternion.angleTo(once)).toBeLessThan(1e-9);
  });
});
