import * as fs from "node:fs";
import * as path from "node:path";
import {
  CAPSULE_BOTTOM_OFFSET,
  CARRY_GRIP,
  GETUP_MS,
  PICKUP_CLIP_SECONDS,
  PICKUP_CONTACT_SECONDS,
  PROP_TOSS_RELEASE_LIFT,
  PROP_TOSS_RELEASE_REACH,
  RAGDOLL_MIN_MS,
  SPIN_GRIP,
  THROW_RELEASE_SECONDS,
} from "@dont-fall/shared";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";
import { CHARACTER_VISUAL_HEIGHT, KNOCKDOWN_DIRECTIONS, loadCharacterActions, MODEL_YAW_OFFSET } from "./characterModel.js";
import { FloatLimbs } from "./floatPose.js";
import { FOOT_CONTACTS } from "./footsteps.js";
import { KNOCKDOWN_SECTORS } from "./knockdownAnimation.js";

const MODEL_PATH = path.resolve(import.meta.dirname, "../../public/models/BLIP.glb");

/**
 * Loads the REAL BLIP asset (M6.1 ticket 05, code review; retargeted in ADR
 * 0071; v6 knockdown in ADR 0076; v7 gaits in ADR 0081). Every other test touching bones or clips
 * builds its own synthetic rig, which can only ever be as correct as the
 * convention its author assumed. One such assumption was wrong: the source
 * file's own `nodes[].name` field carries a `.` (`upper_arm.L`), but
 * `GLTFLoader` strips it when constructing the scene graph (the real node is
 * `upper_armL`) — almost certainly because `AnimationClip` track paths are
 * themselves dot-separated `nodeName.property` strings. The since-deleted
 * `armReach.ts` and `ragdollPose.ts` were both built against the dotted
 * (wrong) names and silently matched nothing against the real model — found
 * live ("Grab visibly does nothing"), not by any of this codebase's existing
 * tests. This file exists so a future rename, asset swap, or copy-pasted name
 * fails loudly here instead, and so do the measurements the knockdown relies
 * on.
 */
describe("BLIP.glb — real model, real bone names", () => {
  let scene: THREE.Object3D;
  let animations: THREE.AnimationClip[];

  beforeAll(async () => {
    // An exact copy, never `Buffer.buffer` — the same rule `parseAssetVisual`
    // states: a Buffer is a view into a larger pooled store, and GLTFLoader
    // reads the whole ArrayBuffer it is handed (it would see anything but a
    // GLB header and fall back to parsing the bytes as JSON).
    const raw = fs.readFileSync(MODEL_PATH);
    const exact = new Uint8Array(raw.byteLength);
    exact.set(raw);
    ({ scene, animations } = await new GLTFLoader().parseAsync(exact.buffer, path.dirname(MODEL_PATH) + "/"));
  });

  it("carries its rig nodes under the names the loader actually produces", () => {
    // The dotted/undotted trap, pinned per node: the file says `upper_arm.L`
    // and the loaded graph says `upper_armL`.
    for (const node of ["pelvis", "body", "head", "upper_armL", "forearmL", "upper_armR", "forearmR", "thighL", "shinL", "thighR", "shinR"]) {
      expect(scene.getObjectByName(node), node).toBeDefined();
    }
    expect(scene.getObjectByName("upper_arm.L")).toBeUndefined();
  });

  it("needs no turn to face the way the engine does — both rigs already look down +Z", () => {
    // `scene.ts`'s forward is `(sin yaw, 0, cos yaw)`, so yaw 0 is +Z, and
    // BLIP's eyes are in front at +Z. A π here once made every Character walk
    // backwards (found live, 2026-09-16).
    expect(MODEL_YAW_OFFSET).toBe(0);
    scene.updateMatrixWorld(true);
    const eye = scene.getObjectByName("eyeL")!.getWorldPosition(new THREE.Vector3());
    expect(eye.z).toBeGreaterThan(0);
  });

  describe("where a carried Prop is held (ADR 0125, ADR 0128)", () => {
    // Its own copy, scaled and seated exactly as the Stage draws the model,
    // so posing it cannot leak into the other tests' shared scene.
    let own: { scene: THREE.Group; animations: THREE.AnimationClip[] };
    let mixer: THREE.AnimationMixer;
    beforeAll(async () => {
      const raw = fs.readFileSync(MODEL_PATH);
      const exact = new Uint8Array(raw.byteLength);
      exact.set(raw);
      own = await new GLTFLoader().parseAsync(exact.buffer, path.dirname(MODEL_PATH) + "/");
      const bounds = new THREE.Box3().setFromObject(own.scene);
      const scale = CHARACTER_VISUAL_HEIGHT / (bounds.max.y - bounds.min.y);
      own.scene.scale.setScalar(scale);
      own.scene.position.y = -bounds.min.y * scale;
      mixer = new THREE.AnimationMixer(own.scene);
    });

    /** The pose `clip` has at `time`, drawn: the hands' midpoint and spread, and how far forward the body (arms aside) reaches at their height. */
    const grip = (clip: string, time: number) => {
      mixer.stopAllAction();
      const action = mixer.clipAction(own.animations.find((c) => c.name === clip)!);
      // Held on its last frame rather than wrapped back to its first.
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.reset().play();
      mixer.setTime(time);
      own.scene.updateMatrixWorld(true);
      const left = own.scene.getObjectByName("handL")!.getWorldPosition(new THREE.Vector3());
      const right = own.scene.getObjectByName("handR")!.getWorldPosition(new THREE.Vector3());
      const between = left.clone().add(right).multiplyScalar(0.5);
      let body: THREE.SkinnedMesh | undefined;
      own.scene.traverse((o) => {
        if (!body && (o as THREE.SkinnedMesh).isSkinnedMesh) body = o as THREE.SkinnedMesh;
      });
      const arms = new Set(body!.skeleton.bones.flatMap((bone, i) => (/arm|hand/.test(bone.name) ? [i] : [])));
      const { skinIndex, skinWeight, position } = body!.geometry.attributes;
      const vertex = new THREE.Vector3();
      let front = -Infinity;
      for (let i = 0; i < position!.count; i += 1) {
        let onArms = 0;
        for (let k = 0; k < 4; k += 1) if (arms.has(skinIndex!.getComponent(i, k))) onArms += skinWeight!.getComponent(i, k);
        if (onArms > 0.2) continue;
        body!.getVertexPosition(i, vertex).applyMatrix4(body!.matrixWorld);
        if (Math.abs(vertex.y - between.y) < 0.05) front = Math.max(front, vertex.z);
      }
      // Forward is +Z on the model (MODEL_YAW_OFFSET is 0); the feet sit at the capsule's bottom.
      expect(Math.abs(between.x)).toBeLessThan(0.05);
      return { reach: between.z, lift: between.y - CAPSULE_BOTTOM_OFFSET, spread: left.distanceTo(right), bodyFront: front };
    };

    it("holds the carry's grip where Pickup_Ground ends — the hold every carry clip starts from", () => {
      const measured = grip("Pickup_Ground", PICKUP_CLIP_SECONDS);
      expect(measured.reach).toBeCloseTo(CARRY_GRIP.reach, 1);
      expect(measured.lift).toBeCloseTo(CARRY_GRIP.lift, 1);
      expect(measured.spread).toBeCloseTo(CARRY_GRIP.spread, 1);
      expect(measured.bodyFront).toBeCloseTo(CARRY_GRIP.bodyFront, 1);
      // Carry_Walk and Throw_Item start from the same hands.
      for (const clip of ["Carry_Walk", "Throw_Item"]) {
        expect(grip(clip, 0).reach).toBeCloseTo(CARRY_GRIP.reach, 1);
        expect(grip(clip, 0).lift).toBeCloseTo(CARRY_GRIP.lift, 1);
      }
    });

    it("holds a Spin's grip where Grab_HoldOut, which never moves its hands, has them", () => {
      const measured = grip("Grab_HoldOut", 0);
      expect(measured.reach).toBeCloseTo(SPIN_GRIP.reach, 1);
      expect(measured.lift).toBeCloseTo(SPIN_GRIP.lift, 1);
      expect(measured.spread).toBeCloseTo(SPIN_GRIP.spread, 1);
      expect(measured.bodyFront).toBeCloseTo(SPIN_GRIP.bodyFront, 1);
    });

    it("lets a Toss go from where Throw_Item has the hands at its release", () => {
      const measured = grip("Throw_Item", THROW_RELEASE_SECONDS);
      expect(measured.reach).toBeCloseTo(PROP_TOSS_RELEASE_REACH, 1);
      expect(measured.lift).toBeCloseTo(PROP_TOSS_RELEASE_LIFT, 1);
    });

    it("times the Lift and the Toss by the clips' own events", () => {
      // The loader keeps no clip extras, so they are read off the file's JSON chunk.
      const raw = fs.readFileSync(MODEL_PATH);
      const json = JSON.parse(raw.subarray(20, 20 + raw.readUInt32LE(12)).toString("utf8")) as {
        animations: { name: string; extras?: { duration_seconds?: number; events?: { name: string; time: number }[] } }[];
      };
      const extras = (name: string) => json.animations.find((clip) => clip.name === name)!.extras!;
      const event = (clip: string, name: string) => extras(clip).events!.find((e) => e.name === name)!.time;
      expect(extras("Pickup_Ground").duration_seconds).toBe(PICKUP_CLIP_SECONDS);
      expect(event("Pickup_Ground", "pickup_contact")).toBe(PICKUP_CONTACT_SECONDS);
      expect(event("Throw_Item", "item_release")).toBe(THROW_RELEASE_SECONDS);
    });
  });

  it("carries every clip the renderer binds — a misspelt name would quietly animate nothing", () => {
    const actions = loadCharacterActions(new THREE.AnimationMixer(scene), animations);
    const missing = Object.entries(actions).flatMap(([name, bound]) => {
      if (bound instanceof THREE.AnimationAction) return [];
      if (bound === null) return [name];
      return Object.entries(bound)
        .filter(([, action]) => action === null)
        .map(([direction]) => `${name}.${direction}`);
    });
    expect(missing).toEqual([]);
  });

  it("cuts its five jump pieces out of Jump_Full, end to end — played in a row, they are that clip", () => {
    // The jump sequence (`jumpSequence.ts`, ADR 0071) lays the pieces on one
    // timeline and walks it without crossfading between them. That is only
    // seamless if each piece starts on the pose the last one ended on, which
    // is true because they are cut from the one clip. Pinned against every
    // bone at both ends of every piece, except the root's height: `Jump_Full`
    // lifts its root by 1.2 units and the pieces do not.
    const full = clip("Jump_Full");
    const pieces = ["Jump_Start", "Jump_Rise", "Jump_Apex", "Jump_Fall", "Jump_Land"].map(clip);
    expect(pieces.reduce((sum, piece) => sum + piece.duration, 0)).toBeCloseTo(full.duration, 2);

    const sample = (track: THREE.KeyframeTrack, time: number): number[] =>
      Array.from(track.createInterpolant().evaluate(time) as ArrayLike<number>);
    let offset = 0;
    for (const piece of pieces) {
      for (const time of [0, piece.duration]) {
        for (const track of piece.tracks) {
          if (track.name === "root.position") continue;
          const whole = full.tracks.find((t) => t.name === track.name)!;
          const [a, b] = [sample(track, time), sample(whole, offset + time)];
          a.forEach((value, i) => expect(value, `${piece.name} ${track.name} @${time}`).toBeCloseTo(b[i]!, 2));
        }
      }
      offset += piece.duration;
    }
  });
  it("carries every bone the Float's procedural layer drives (ADR 0077)", () => {
    expect(new FloatLimbs(scene).complete).toBe(true);
  });

  const clip = (name: string) => THREE.AnimationClip.findByName(animations, name)!;

  /** Poses `scene` on `name` at `time`, runs `read`, and puts the rig back on its bind pose. */
  const posedAt = <T>(name: string, time: number, read: () => T): T => {
    const mixer = new THREE.AnimationMixer(scene);
    const action = mixer.clipAction(clip(name));
    action.play();
    action.paused = true;
    action.time = time;
    mixer.update(0);
    scene.updateMatrixWorld(true);
    try {
      return read();
    } finally {
      mixer.stopAllAction();
      mixer.uncacheRoot(scene);
      scene.updateMatrixWorld(true);
    }
  };
  const worldOf = (node: string): THREE.Vector3 => scene.getObjectByName(node)!.getWorldPosition(new THREE.Vector3());

  describe("the gaits (ADR 0081)", () => {
    const GAITS = ["Walk", "Run", "Sprint"];

    // A change of gait carries its step across (`crossfadeLocomotion`): the
    // Sprint starts at the point of the stride the Run had reached. That is
    // only the same step if every gait puts the same foot down at the same
    // point, so it is measured here rather than taken from the rig's notes.
    it.each(GAITS)("%s puts the left foot down in front at the start of its stride, and the right halfway", (name) => {
      const { duration } = clip(name);
      const feetAt = (stride: number) =>
        posedAt(name, stride * duration, () => ({ left: worldOf("footL"), right: worldOf("footR") }));
      let floor = Infinity;
      for (let stride = 0; stride < 1; stride += 1 / 32) {
        const { left, right } = feetAt(stride);
        floor = Math.min(floor, left.y, right.y);
      }
      // A Sprint's stance presses the foot about 0.01 below where it lands; a
      // foot in the air is at least 0.12 above it (in the rig's own 3.5-unit
      // height).
      const start = feetAt(0);
      expect(start.left.y - floor, "left foot on the floor").toBeLessThan(0.02);
      expect(start.left.z).toBeGreaterThan(start.right.z);
      const half = feetAt(0.5);
      expect(half.right.y - floor, "right foot on the floor").toBeLessThan(0.02);
      expect(half.right.z).toBeGreaterThan(half.left.z);
    });

    // Footsteps (M14 ticket 04) are heard where these clips put a foot down.
    // A touchdown is the frame a foot drops below 15% of its lift above the
    // clip's floor.
    it.each([...GAITS, "Wobble_Walk"])("%s puts a foot down at every FOOT_CONTACTS fraction, and nowhere else", (name) => {
      const { duration } = clip(name);
      const samples = 240;
      const heights = Array.from({ length: samples }, (_, i) =>
        posedAt(name, (i / samples) * duration, () => ({ l: worldOf("footL").y, r: worldOf("footR").y })),
      );
      const all = heights.flatMap(({ l, r }) => [l, r]);
      const floor = Math.min(...all);
      const threshold = floor + (Math.max(...all) - floor) * 0.15;
      const touchdowns = (["l", "r"] as const).flatMap((foot) =>
        heights.flatMap((sample, i) => {
          const previous = heights[(i - 1 + samples) % samples]![foot];
          return previous > threshold && sample[foot] <= threshold ? [i / samples] : [];
        }),
      );
      const circular = (a: number, b: number) => Math.min(Math.abs(a - b), 1 - Math.abs(a - b));
      expect(touchdowns).toHaveLength(FOOT_CONTACTS.length);
      for (const contact of FOOT_CONTACTS) {
        expect(Math.min(...touchdowns.map((touchdown) => circular(touchdown, contact))), `${name} at ${contact}`).toBeLessThan(0.02);
      }
    });

    it("gets quicker as it gets faster — Walk, then Run, then Sprint", () => {
      const [walk, run, sprint] = GAITS.map((name) => clip(name).duration);
      expect(walk).toBeGreaterThan(run!);
      expect(run).toBeGreaterThan(sprint!);
    });
  });

  describe("the knockdown (ADR 0076)", () => {
    const sample = (track: THREE.KeyframeTrack, time: number): number[] =>
      Array.from(track.createInterpolant().evaluate(time) as ArrayLike<number>);

    it.each(KNOCKDOWN_DIRECTIONS)("ends KO_%s on the very pose GetUp_%s begins with", (direction) => {
      const ko = clip(`KO_${direction}`);
      const getUp = clip(`GetUp_${direction}`);
      for (const track of ko.tracks) {
        const next = getUp.tracks.find((t) => t.name === track.name)!;
        const [end, start] = [sample(track, ko.duration), sample(next, 0)];
        end.forEach((value, i) => expect(value, `${track.name}[${i}]`).toBeCloseTo(start[i]!, 3));
      }
    });

    it.each(KNOCKDOWN_SECTORS.map((direction, i) => [direction, i * 60] as const))(
      "lays the body down along its sector: KO_%s at %i° from forward",
      (direction, degrees) => {
        const ko = clip(`KO_${direction}`);
        const body = posedAt(`KO_${direction}`, ko.duration, () => worldOf("body"));
        const measured = ((Math.atan2(body.x, body.z) * 180) / Math.PI + 360) % 360;
        const off = Math.abs(((measured - degrees + 540) % 360) - 180);
        expect(off, `KO_${direction} lies at ${measured.toFixed(1)}°`).toBeLessThan(5);
      },
    );

    it("falls for exactly as long as the sim keeps a Character down at least", () => {
      for (const direction of KNOCKDOWN_DIRECTIONS) {
        expect(Math.abs(clip(`KO_${direction}`).duration * 1000 - RAGDOLL_MIN_MS), `KO_${direction}`).toBeLessThan(1);
      }
    });

    it.each(KNOCKDOWN_DIRECTIONS)("has both feet planted in GetUp_%s from the frame control comes back on", (direction) => {
      const getUp = clip(`GetUp_${direction}`);
      const from = GETUP_MS / 1000;
      const feetAt = (time: number) => posedAt(`GetUp_${direction}`, time, () => [worldOf("footL"), worldOf("footR")]);
      const planted = feetAt(from);
      for (let time = from; time <= getUp.duration; time += 0.1) {
        feetAt(time).forEach((foot, i) =>
          expect(foot.distanceTo(planted[i]!), `foot ${i} @${time.toFixed(2)}s`).toBeLessThan(0.02),
        );
      }
    });
  });
});
