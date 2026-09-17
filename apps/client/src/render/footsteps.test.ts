import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { contactsCrossed, footstepSound, Footsteps, steppingClip } from "./footsteps.js";
import type { CharacterActions } from "./characterModel.js";

const clipAction = (duration: number): THREE.AnimationAction => {
  const mixer = new THREE.AnimationMixer(new THREE.Object3D());
  return mixer.clipAction(new THREE.AnimationClip("gait", duration, []));
};

describe("contactsCrossed (M14 ticket 04)", () => {
  it("counts the contacts passed since last frame, including one landed on exactly", () => {
    expect(contactsCrossed(0.4, 0.5)).toBe(1);
    expect(contactsCrossed(0.4, 0.49)).toBe(1);
    expect(contactsCrossed(0.49, 0.6)).toBe(0);
    expect(contactsCrossed(0.1, 0.2)).toBe(0);
  });

  it("counts across the loop's wrap", () => {
    expect(contactsCrossed(0.98, 0.02)).toBe(1);
    expect(contactsCrossed(0.45, 0.02)).toBe(2);
  });
});

describe("Footsteps", () => {
  it("steps as the clip passes each contact, once per foot", () => {
    const footsteps = new Footsteps();
    const run = clipAction(0.8);
    const at = (fraction: number) => {
      run.time = fraction * 0.8;
      return footsteps.update("a", run);
    };
    expect(at(0.3)).toBe(0); // first frame only records
    expect(at(0.45)).toBe(0);
    expect(at(0.5)).toBe(1);
    expect(at(0.9)).toBe(0);
    expect(at(0.995)).toBe(1);
    expect(at(0.1)).toBe(0);
  });

  it("never steps on a change of clip, or after nothing stepped", () => {
    const footsteps = new Footsteps();
    const run = clipAction(0.8);
    const wobble = clipAction(1.6);
    run.time = 0.3;
    footsteps.update("a", run);
    wobble.time = 0; // a clip starting over from zero would otherwise read as a wrap past both feet
    expect(footsteps.update("a", wobble)).toBe(0);
    expect(footsteps.update("a", null)).toBe(0);
    run.time = 0.79;
    expect(footsteps.update("a", run)).toBe(0);
  });

  it("keeps Characters apart", () => {
    const footsteps = new Footsteps();
    const a = clipAction(1);
    const b = clipAction(1);
    a.time = 0.4;
    b.time = 0.4;
    footsteps.update("a", a);
    footsteps.update("b", b);
    a.time = 0.5;
    expect(footsteps.update("a", a)).toBe(1);
    expect(footsteps.update("b", b)).toBe(0);
  });
});

describe("steppingClip", () => {
  it("names the gaits and the unsteady walk, and nothing else", () => {
    const [walk, run, sprint, wobbleWalk, idle] = [1, 1, 1, 1, 1].map(clipAction) as THREE.AnimationAction[];
    const actions = { walk, run, sprint, wobbleWalk, idle } as unknown as CharacterActions;
    expect(steppingClip(walk!, actions)).toBe("walk");
    expect(steppingClip(sprint!, actions)).toBe("sprint");
    expect(steppingClip(wobbleWalk!, actions)).toBe("wobbleWalk");
    expect(steppingClip(idle!, actions)).toBeNull();
    expect(steppingClip(null, actions)).toBeNull();
  });
});

describe("footstepSound", () => {
  it("picks the slot by surface", () => {
    expect(footstepSound("run", "deck", false).slot).toBe("character.footstep");
    expect(footstepSound("run", "mud", false).slot).toBe("surface.mud");
    expect(footstepSound("run", "ice", false).slot).toBe("surface.ice");
    expect(footstepSound("run", "bounce", false).slot).toBe("surface.bounce");
  });

  it("stamps harder the faster the gait, and is quieter for another player", () => {
    const walk = footstepSound("walk", "deck", false).gain;
    const run = footstepSound("run", "deck", false).gain;
    const sprint = footstepSound("sprint", "deck", false).gain;
    expect(walk).toBeLessThan(run);
    expect(run).toBeLessThan(sprint);
    expect(footstepSound("run", "deck", true).gain).toBeLessThan(run);
    expect(footstepSound("run", "bounce", false).gain).toBeLessThan(run);
  });
});
