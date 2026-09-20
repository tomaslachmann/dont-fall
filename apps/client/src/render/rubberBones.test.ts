import * as fs from "node:fs";
import * as path from "node:path";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  impactDeflection,
  RUBBER_BONES,
  RubberBones,
  type RubberBoneSpec,
  stepSpring,
} from "./rubberBones.js";

const FORWARD = { x: 0, y: 0, z: 1 };
const RIGHT = { x: 1, y: 0, z: 0 };

describe("stepSpring", () => {
  it("rings down to nothing from a kick", () => {
    let state = { angle: 0, velocity: 8 };
    for (let i = 0; i < 300; i += 1) state = stepSpring(state, 1 / 60, 3, 0.4);
    expect(Math.abs(state.angle)).toBeLessThan(1e-3);
    expect(Math.abs(state.velocity)).toBeLessThan(1e-3);
  });

  it("overshoots — a bone that only eased home would never read as rubber", () => {
    let state: { angle: number; velocity: number } = { angle: 0.5, velocity: 0 };
    let crossed = false;
    for (let i = 0; i < 120 && !crossed; i += 1) {
      state = stepSpring(state, 1 / 120, 3, 0.35);
      if (state.angle < 0) crossed = true;
    }
    expect(crossed, "deflection crosses through zero").toBe(true);
  });

  it("rings the same at any frame rate — the reason it is solved, not integrated", () => {
    const start = { angle: 0.3, velocity: 4 };
    const once = stepSpring(start, 0.1, 4, 0.3);
    let stepped = start;
    for (let i = 0; i < 20; i += 1) stepped = stepSpring(stepped, 0.005, 4, 0.3);
    expect(stepped.angle).toBeCloseTo(once.angle, 9);
    expect(stepped.velocity).toBeCloseTo(once.velocity, 9);
  });

  it("stays finite at and beyond critical damping, where the underdamped solution is singular", () => {
    for (const zeta of [1, 1.5, 40]) {
      const state = stepSpring({ angle: 0.2, velocity: 1 }, 1 / 60, 4, zeta);
      expect(Number.isFinite(state.angle), `zeta ${zeta}`).toBe(true);
      expect(Number.isFinite(state.velocity), `zeta ${zeta}`).toBe(true);
    }
  });

  it("does nothing on a zero or negative delta", () => {
    const start = { angle: 0.2, velocity: 1 };
    expect(stepSpring(start, 0, 4, 0.3)).toBe(start);
    expect(stepSpring(start, -0.01, 4, 0.3)).toBe(start);
  });
});

describe("impactDeflection", () => {
  it("makes a bone trail a shove from behind — pushed forward, the body goes back", () => {
    const { pitch, roll } = impactDeflection({ direction: FORWARD, magnitude: 1 }, FORWARD, RIGHT);
    expect(pitch).toBeLessThan(0);
    expect(roll).toBeCloseTo(0, 12);
  });

  it("rolls away from a shove from the side", () => {
    const { pitch, roll } = impactDeflection({ direction: RIGHT, magnitude: 1 }, FORWARD, RIGHT);
    expect(roll).toBeGreaterThan(0);
    expect(pitch).toBeCloseTo(0, 12);
  });

  it("mirrors: a shove from ahead and one from behind deflect opposite ways", () => {
    const ahead = impactDeflection({ direction: { x: 0, y: 0, z: -1 }, magnitude: 1 }, FORWARD, RIGHT);
    const behind = impactDeflection({ direction: FORWARD, magnitude: 1 }, FORWARD, RIGHT);
    expect(ahead.pitch).toBeCloseTo(-behind.pitch, 12);
  });

  it("scales with magnitude and ignores the direction's own length", () => {
    const unit = impactDeflection({ direction: RIGHT, magnitude: 0.5 }, FORWARD, RIGHT);
    const long = impactDeflection({ direction: { x: 9, y: 0, z: 0 }, magnitude: 0.5 }, FORWARD, RIGHT);
    expect(long.roll).toBeCloseTo(unit.roll, 12);
    const full = impactDeflection({ direction: RIGHT, magnitude: 1 }, FORWARD, RIGHT);
    expect(full.roll).toBeCloseTo(unit.roll * 2, 12);
  });

  it("reads a purely vertical shove, or none at all, as nothing to bend", () => {
    expect(impactDeflection({ direction: { x: 0, y: 1, z: 0 }, magnitude: 1 }, FORWARD, RIGHT)).toEqual({ pitch: 0, roll: 0 });
    expect(impactDeflection({ direction: RIGHT, magnitude: 0 }, FORWARD, RIGHT)).toEqual({ pitch: 0, roll: 0 });
  });
});

/** A rig carrying every name {@link RUBBER_BONES} asks for, each a child of the root. */
const fakeRig = (): THREE.Object3D => {
  const root = new THREE.Group();
  for (const spec of RUBBER_BONES) {
    const bone = new THREE.Object3D();
    // The loader strips the dots, so the rig this layer meets never has them.
    bone.name = spec.name.replace(/\./g, "");
    root.add(bone);
  }
  return root;
};

const angleOf = (root: THREE.Object3D, name: string): number => {
  const bone = root.getObjectByName(name.replace(/\./g, ""))!;
  return 2 * Math.acos(Math.min(1, Math.abs(bone.quaternion.w)));
};

/** Runs `frames` frames of 1/60 s from `t0`, resetting each bone as the mixer would. */
const run = (rig: THREE.Object3D, layer: RubberBones, t0: number, frames: number): number => {
  let t = t0;
  for (let i = 0; i < frames; i += 1) {
    for (const child of rig.children) child.quaternion.identity(); // what `mixer.update` does
    layer.apply(t);
    t += 1000 / 60;
  }
  return t;
};

describe("RubberBones", () => {
  it("finds every bone it drives on a rig that has them", () => {
    expect(new RubberBones(fakeRig()).complete).toBe(true);
  });

  it("reports a rig it does not know instead of half-driving it", () => {
    const root = new THREE.Group();
    root.add(Object.assign(new THREE.Object3D(), { name: "pelvis" }));
    expect(new RubberBones(root).complete).toBe(false);
  });

  it("is still until something hits it — walking is as steady as it was", () => {
    const rig = fakeRig();
    const layer = new RubberBones(rig);
    run(rig, layer, 0, 30);
    expect(layer.ringing).toBe(false);
    for (const child of rig.children) expect(child.quaternion.w).toBe(1);
  });

  it("bends the bones after an Impact", () => {
    const rig = fakeRig();
    const layer = new RubberBones(rig);
    run(rig, layer, 0, 2);
    layer.impact({ direction: FORWARD, magnitude: 1 }, 1000);
    run(rig, layer, 1000, 12);
    expect(angleOf(rig, "head")).toBeGreaterThan(0.05);
  });

  it("lets the kick travel up the body — the head is still still while the hips have moved", () => {
    const rig = fakeRig();
    const layer = new RubberBones(rig);
    run(rig, layer, 0, 2);
    layer.impact({ direction: FORWARD, magnitude: 1 }, 1000);
    // 33 ms in: past `pelvis` (0 ms), short of `head` (55 ms).
    run(rig, layer, 1000, 2);
    expect(angleOf(rig, "pelvis")).toBeGreaterThan(0);
    expect(angleOf(rig, "head")).toBe(0);
  });

  it("never turns the model root — that yaw is the Character's replicated facing (ADR 0085)", () => {
    const rig = fakeRig();
    const layer = new RubberBones(rig);
    layer.impact({ direction: { x: 0.6, y: 0, z: 0.8 }, magnitude: 1 }, 0);
    run(rig, layer, 0, 60);
    expect(rig.quaternion.w).toBe(1);
    expect(rig.position.lengthSq()).toBe(0);
  });

  it("settles back to the mixer's own pose", () => {
    const rig = fakeRig();
    const layer = new RubberBones(rig);
    run(rig, layer, 0, 2);
    layer.impact({ direction: RIGHT, magnitude: 1 }, 1000);
    run(rig, layer, 1000, 400);
    expect(layer.ringing).toBe(false);
    for (const spec of RUBBER_BONES) expect(angleOf(rig, spec.name)).toBeLessThan(1e-3);
  });

  it("never bends a bone past its own clamp, however hard it is hit", () => {
    const rig = fakeRig();
    const layer = new RubberBones(rig);
    run(rig, layer, 0, 2);
    for (let i = 0; i < 10; i += 1) layer.impact({ direction: FORWARD, magnitude: 1 }, 1000 + i);
    let t = 1000;
    for (let i = 0; i < 200; i += 1) {
      t = run(rig, layer, t, 1);
      for (const spec of RUBBER_BONES) {
        // Two clamped axes compose, so the worst case is the diagonal of the pair.
        expect(angleOf(rig, spec.name), spec.name).toBeLessThanOrEqual(spec.maxAngle * Math.SQRT2 + 1e-6);
      }
    }
  });

  it("drops everything on reset", () => {
    const rig = fakeRig();
    const layer = new RubberBones(rig);
    run(rig, layer, 0, 2);
    layer.impact({ direction: FORWARD, magnitude: 1 }, 1000);
    run(rig, layer, 1000, 6);
    expect(layer.ringing).toBe(true);
    layer.reset();
    expect(layer.ringing).toBe(false);
    run(rig, layer, 1200, 4);
    for (const spec of RUBBER_BONES) expect(angleOf(rig, spec.name)).toBe(0);
  });

  it("delivers a kick whose delay elapsed during a dropped frame instead of losing it", () => {
    const rig = fakeRig();
    const only: RubberBoneSpec[] = [{ name: "head", gain: 1, delayMs: 55, hz: 3.4, zeta: 0.38, maxAngle: 0.5 }];
    const layer = new RubberBones(rig, only);
    layer.apply(1000);
    layer.impact({ direction: FORWARD, magnitude: 1 }, 1000);
    // One 90 ms frame jumps clean over the 55 ms the head waits.
    for (const child of rig.children) child.quaternion.identity();
    layer.apply(1090);
    expect(layer.ringing).toBe(true);
    expect(angleOf(rig, "head")).toBeGreaterThan(0);
  });

  it("writes nothing at scale 0, and keeps ringing underneath so it can be faded back in", () => {
    const rig = fakeRig();
    const layer = new RubberBones(rig);
    layer.apply(1000);
    layer.impact({ direction: FORWARD, magnitude: 1 }, 1000);
    for (let i = 0; i < 6; i += 1) {
      for (const child of rig.children) child.quaternion.identity();
      layer.apply(1000 + (i + 1) * 16, 0);
    }
    for (const spec of RUBBER_BONES) expect(angleOf(rig, spec.name)).toBe(0);
    expect(layer.ringing).toBe(true);
  });
});

/**
 * The bug the synthetic rig above cannot see, and the user found by playing
 * the demo: {@link run} resets every bone each frame, which is what a mixer
 * does only while a clip is actually *changing* that bone. three.js's
 * `PropertyMixer.apply` skips the write whenever the accumulated value
 * matches the one it last wrote, so a bone a clip holds still — an arm
 * through `Idle` — is written once and then never again.
 */
describe("RubberBones over a bone its clip holds still", () => {
  /** A pose written once, as a mixer writes a bone a clip does not move. */
  const HELD = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.609);

  const stillRig = (): THREE.Object3D => {
    const rig = fakeRig();
    for (const child of rig.children) child.quaternion.copy(HELD);
    return rig;
  };

  it("comes back to the held pose instead of walking away from it", () => {
    const rig = stillRig();
    const layer = new RubberBones(rig);
    layer.apply(0);
    layer.impact({ direction: FORWARD, magnitude: 1 }, 0);
    let t = 0;
    for (let i = 0; i < 600; i += 1) {
      t += 1000 / 60;
      layer.apply(t); // nothing rewrites the bones in between — that is the point
    }
    expect(layer.ringing).toBe(false);
    for (const spec of RUBBER_BONES) {
      const bone = rig.getObjectByName(spec.name.replace(/\./g, ""))!;
      expect(bone.quaternion.angleTo(HELD), spec.name).toBeLessThan(1e-3);
      expect(bone.quaternion.length(), `${spec.name} stays a unit quaternion`).toBeCloseTo(1, 9);
    }
  });

  it("still bends it on the way — measured at the peak, not at an arbitrary frame", () => {
    const rig = stillRig();
    const layer = new RubberBones(rig);
    layer.apply(0);
    layer.impact({ direction: FORWARD, magnitude: 1 }, 0);
    const head = rig.getObjectByName("head")!;
    let peak = 0;
    for (let i = 1; i <= 60; i += 1) {
      layer.apply((i * 1000) / 60);
      peak = Math.max(peak, head.quaternion.angleTo(HELD));
    }
    expect(peak).toBeGreaterThan(0.1);
  });

  it("follows the mixer when the mixer does move the bone", () => {
    const rig = stillRig();
    const layer = new RubberBones(rig);
    layer.apply(0);
    const moved = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.1);
    for (let i = 1; i <= 240; i += 1) {
      for (const child of rig.children) child.quaternion.copy(moved);
      layer.apply((i * 1000) / 60);
    }
    for (const spec of RUBBER_BONES) {
      const bone = rig.getObjectByName(spec.name.replace(/\./g, ""))!;
      expect(bone.quaternion.angleTo(moved), spec.name).toBeLessThan(1e-6);
    }
  });
});

/**
 * The real BLIP rig and a real mixer — the only place this layer's own
 * assumption about what a mixer writes can be checked. `modelBones.test.ts`
 * exists for the same reason: every synthetic rig is only as correct as the
 * convention its author assumed, and here that assumption was wrong.
 */
describe("BLIP.glb — the layer over a real Idle", () => {
  let gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] };

  beforeAll(async () => {
    const raw = fs.readFileSync(path.resolve(import.meta.dirname, "../../public/models/BLIP.glb"));
    const exact = new Uint8Array(raw.byteLength);
    exact.set(raw);
    const loaded = await new GLTFLoader().parseAsync(exact.buffer, "");
    gltf = { scene: loaded.scene as THREE.Group, animations: loaded.animations };
  });

  const clipRun = (clipName: string, impact: boolean, seconds: number): THREE.Quaternion => {
    const root = new THREE.Group();
    root.add(gltf.scene.clone(true));
    const mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(THREE.AnimationClip.findByName(gltf.animations, clipName)!);
    // Held on its last frame, exactly as `loadCharacterActions` binds the
    // knockdowns — which is what makes the mixer stop writing.
    if (clipName !== "Idle") {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    }
    action.play();
    const layer = new RubberBones(root);
    expect(layer.complete, "every bone this layer drives is on the real rig").toBe(true);
    let t = 0;
    const step = (): void => {
      mixer.update(1 / 60);
      layer.apply(t);
      t += 1000 / 60;
    };
    step();
    if (impact) layer.impact({ direction: FORWARD, magnitude: 1 }, t);
    for (let i = 0; i < seconds * 60; i += 1) step();
    return root.getObjectByName("forearmL")!.quaternion.clone();
  };

  // Idle holds the arms still and the knockdowns clamp on their last frame,
  // so in both the mixer stops writing and the layer is on its own. The user
  // found this by playing the demo; nothing synthetic had caught it.
  it.each(["Idle", "KO_F", "Death_F", "GetUp_F", "Jump_Apex"])(
    "leaves the forearm exactly where %s puts it, ten seconds after an Impact",
    (clipName) => {
      const untouched = clipRun(clipName, false, 10);
      const afterImpact = clipRun(clipName, true, 10);
      expect(afterImpact.angleTo(untouched)).toBeLessThan(1e-3);
      expect(afterImpact.length()).toBeCloseTo(1, 9);
    },
  );

  it("bends the forearm while the Impact is ringing, on a clip held on its last frame", () => {
    const root = new THREE.Group();
    root.add(gltf.scene.clone(true));
    const mixer = new THREE.AnimationMixer(root);
    const ko = mixer.clipAction(THREE.AnimationClip.findByName(gltf.animations, "KO_F")!);
    ko.setLoop(THREE.LoopOnce, 1);
    ko.clampWhenFinished = true;
    ko.play();
    const layer = new RubberBones(root);
    const forearm = root.getObjectByName("forearmL")!;
    let t = 0;
    const step = (): void => {
      mixer.update(1 / 60);
      layer.apply(t);
      t += 1000 / 60;
    };
    for (let i = 0; i < 180; i += 1) step(); // let KO_F reach its clamp
    const clamped = forearm.quaternion.clone();
    layer.impact({ direction: FORWARD, magnitude: 1 }, t);
    let peak = 0;
    for (let i = 0; i < 60; i += 1) {
      step();
      peak = Math.max(peak, forearm.quaternion.angleTo(clamped));
    }
    expect(peak, "the layer still moves a bone nothing is writing").toBeGreaterThan(0.1);
  });
});
