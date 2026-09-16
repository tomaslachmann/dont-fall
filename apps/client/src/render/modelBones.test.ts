import * as fs from "node:fs";
import * as path from "node:path";
import { GETUP_MS, RAGDOLL_MIN_MS } from "@dont-fall/shared";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { beforeAll, describe, expect, it } from "vitest";
import { KNOCKDOWN_DIRECTIONS, loadCharacterActions, MODEL_YAW_OFFSET } from "./characterModel.js";
import { FloatLimbs } from "./floatPose.js";
import { KNOCKDOWN_SECTORS } from "./knockdownAnimation.js";

const MODEL_PATH = path.resolve(import.meta.dirname, "../../public/models/BLIP.glb");

/**
 * Loads the REAL BLIP asset (M6.1 ticket 05, code review; retargeted in ADR
 * 0071; v6 knockdown in ADR 0076). Every other test touching bones or clips
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
    const clip = (name: string) => THREE.AnimationClip.findByName(animations, name)!;
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

  describe("the knockdown (ADR 0076)", () => {
    const clip = (name: string) => THREE.AnimationClip.findByName(animations, name)!;
    const sample = (track: THREE.KeyframeTrack, time: number): number[] =>
      Array.from(track.createInterpolant().evaluate(time) as ArrayLike<number>);

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
