import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { CharacterActions } from "./characterModel.js";
import { HitReactionPlayer } from "./hitReactionPlayer.js";

const clip = (name: string, duration: number): THREE.AnimationClip =>
  new THREE.AnimationClip(name, duration, [new THREE.NumberKeyframeTrack(".rotation[x]", [0, duration], [0, 1])]);

const setup = () => {
  const root = new THREE.Object3D();
  const mixer = new THREE.AnimationMixer(root);
  const punch = mixer.clipAction(clip("Punch", 0.8));
  const hitReact = mixer.clipAction(clip("HitReact", 0.6));
  punch.setLoop(THREE.LoopOnce, 1);
  punch.clampWhenFinished = false;
  hitReact.setLoop(THREE.LoopOnce, 1);
  hitReact.clampWhenFinished = false;
  const actions: CharacterActions = { idle: null, walk: null, run: null, jump: null, death: null, punch, hitReact };
  return { mixer, actions, punch, hitReact };
};

describe("HitReactionPlayer (M6 ticket 03 — Punch/HitReact, one-shot overlays on top of ordinary locomotion)", () => {
  it("does not react on its very first observation, even if the epochs it sees are already nonzero — the cold-start class of bug already fixed for Ragdoll/GettingUp", () => {
    const { actions } = setup();
    const player = new HitReactionPlayer();
    const result = player.update(5, 3, actions, 0.1);
    expect(result).toBeNull();
  });

  it("starts Punch the instant hitEpoch rises after the baseline is seeded", () => {
    const { actions, punch } = setup();
    const player = new HitReactionPlayer();
    player.update(0, 0, actions, 0.1); // seed baseline
    const result = player.update(1, 0, actions, 0.1);
    expect(result).toBe(punch);
  });

  it("starts HitReact the instant hitReactEpoch rises", () => {
    const { actions, hitReact } = setup();
    const player = new HitReactionPlayer();
    player.update(0, 0, actions, 0.1);
    const result = player.update(0, 1, actions, 0.1);
    expect(result).toBe(hitReact);
  });

  it("returns null once the one-shot has finished playing", () => {
    const { mixer, actions, punch } = setup();
    const player = new HitReactionPlayer();
    player.update(0, 0, actions, 0.1);
    expect(player.update(1, 0, actions, 0.1)).toBe(punch);

    for (let i = 0; i < 60; i += 1) mixer.update(1 / 30); // well past Punch's 0.8s duration
    expect(player.update(1, 0, actions, 0.1)).toBeNull();
  });

  it("keeps returning the reaction on every call while it's still playing, without re-triggering it", () => {
    const { mixer, actions, punch } = setup();
    const player = new HitReactionPlayer();
    player.update(0, 0, actions, 0.1);
    player.update(1, 0, actions, 0.1);
    mixer.update(0.1);
    const timeAfterFirstUpdate = punch.time;

    // A second call with the SAME epoch must not restart the clip.
    const result = player.update(1, 0, actions, 0.1);
    expect(result).toBe(punch);
    expect(punch.time).toBe(timeAfterFirstUpdate);
  });

  it(
    "regression (code review, M6 ticket 03): when both epochs change in the same call — a mutual exchange, " +
      "this Character's own swing landing on someone the same tick it's also hit — HitReact wins outright, " +
      "and Punch is never even started (not started-then-immediately-faded-out before it plays a single frame)",
    () => {
      const { actions, punch, hitReact } = setup();
      const player = new HitReactionPlayer();
      player.update(0, 0, actions, 0.1); // seed baseline

      const punchPlay = vi.spyOn(punch, "play");
      const result = player.update(1, 1, actions, 0.1);

      expect(result).toBe(hitReact);
      expect(punchPlay).not.toHaveBeenCalled();
    },
  );

  it("is a harmless no-op when the model has no Punch/HitReact clip", () => {
    const player = new HitReactionPlayer();
    const noClips: CharacterActions = { idle: null, walk: null, run: null, jump: null, death: null, punch: null, hitReact: null };
    player.update(0, 0, noClips, 0.1);
    expect(() => player.update(1, 0, noClips, 0.1)).not.toThrow();
    expect(player.update(1, 1, noClips, 0.1)).toBeNull();
  });
});
