import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { actionFor, type CharacterActions, crossfadeLocomotion, isGait } from "./characterModel.js";

const clip = (name: string, duration: number): THREE.AnimationClip =>
  new THREE.AnimationClip(name, duration, [new THREE.NumberKeyframeTrack(".rotation[x]", [0, duration], [0, 1])]);

const noDirections = { F: null, FL: null, FR: null, B: null, BL: null, BR: null };

/** The rig's three gaits at v7's own lengths (ADR 0081), plus one clip that is not a gait. */
const setup = () => {
  const mixer = new THREE.AnimationMixer(new THREE.Object3D());
  const [idle, walk, run, sprint, jumpRise] = (
    [
      ["Idle", 2],
      ["Walk", 1.2],
      ["Run", 0.8],
      ["Sprint", 0.6],
      ["Jump_Rise", 0.27],
    ] as const
  ).map(([name, duration]) => mixer.clipAction(clip(name, duration)));
  const actions: CharacterActions = {
    idle: idle!,
    walk: walk!,
    run: run!,
    sprint: sprint!,
    jumpStart: null,
    jumpRise: jumpRise!,
    jumpApex: null,
    jumpFall: null,
    jumpLand: null,
    punch: null,
    hitReact: null,
    ko: noDirections,
    getUp: noDirections,
    death: noDirections,
    grabReach: null,
    grabPull: null,
    grabHold: null,
    grabDropOut: null,
    struggleHeld: null,
    struggleAir: null,
    wobble: null,
    wobbleWalk: null,
  };
  return { mixer, actions };
};

describe("the gaits (ADR 0081)", () => {
  it("counts Walk, Run and Sprint as gaits, and nothing else", () => {
    const { actions } = setup();
    expect([actions.walk, actions.run, actions.sprint].every((action) => isGait(action, actions))).toBe(true);
    expect(isGait(actions.idle, actions)).toBe(false);
    expect(isGait(actions.jumpRise, actions)).toBe(false);
    expect(isGait(null, actions)).toBe(false);
  });

  it("falls back to the next slower gait a rig has", () => {
    const { actions } = setup();
    expect(actionFor("sprint", actions)).toBe(actions.sprint);
    expect(actionFor("sprint", { ...actions, sprint: null })).toBe(actions.run);
    expect(actionFor("sprint", { ...actions, sprint: null, run: null })).toBe(actions.walk);
  });

  it("starts the Sprint at the point of the stride the Run had reached — the Dash keeps the step", () => {
    const { mixer, actions } = setup();
    const run = crossfadeLocomotion(actions.run, null, 0.15, actions)!;
    mixer.update(0.5); // 0.5 s into a 0.8 s stride
    expect(run.time).toBeCloseTo(0.5);

    const sprint = crossfadeLocomotion(actions.sprint, run, 0.15, actions);
    expect(sprint).toBe(actions.sprint);
    expect(sprint!.time).toBeCloseTo((0.5 / 0.8) * 0.6);
  });

  it("carries the stride across a wrapped loop too — Walk into Run", () => {
    const { mixer, actions } = setup();
    const walk = crossfadeLocomotion(actions.walk, null, 0.15, actions)!;
    mixer.update(1.5); // one full 1.2 s stride, and a quarter of the next
    const run = crossfadeLocomotion(actions.run, walk, 0.15, actions)!;
    expect(run.time).toBeCloseTo(0.25 * 0.8);
  });

  it("starts from the first frame out of anything that isn't a gait, or without the rig's actions", () => {
    const { mixer, actions } = setup();
    const idle = crossfadeLocomotion(actions.idle, null, 0.15, actions)!;
    mixer.update(0.5);
    expect(crossfadeLocomotion(actions.run, idle, 0.15, actions)!.time).toBe(0);

    mixer.update(0.5);
    // Into a pose that isn't a gait, nothing is carried either.
    expect(crossfadeLocomotion(actions.jumpRise, actions.run, 0.15, actions)!.time).toBe(0);

    const { mixer: other, actions: bare } = setup();
    const walk = crossfadeLocomotion(bare.walk, null, 0.15)!;
    other.update(0.5);
    expect(crossfadeLocomotion(bare.run, walk, 0.15)!.time).toBe(0);
  });

  it("leaves a gait that is already playing alone", () => {
    const { mixer, actions } = setup();
    const run = crossfadeLocomotion(actions.run, null, 0.15, actions)!;
    mixer.update(0.3);
    expect(crossfadeLocomotion(actions.run, run, 0.15, actions)).toBe(run);
    expect(run.time).toBeCloseTo(0.3);
  });
});
