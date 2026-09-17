import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  GrabAnimations,
  grabAttemptPoseAt,
  grabHoldPoseAt,
  grabRoleOf,
  strugglePoseAt,
} from "./grabAnimation.js";
import type { CharacterActions, ClipPose } from "./characterModel.js";

const clip = (name: string, duration: number) =>
  new THREE.AnimationClip(name, duration, [
    new THREE.VectorKeyframeTrack(".position", [0, duration], [0, 0, 0, 0, 0, 0]),
  ]);

const rig = () => {
  const mixer = new THREE.AnimationMixer(new THREE.Object3D());
  const grabReach = mixer.clipAction(clip("Grab_Reach", 0.67));
  const grabPull = mixer.clipAction(clip("Grab_Pull", 0.47));
  const grabHold = mixer.clipAction(clip("Grab_HoldIn", 1));
  const grabDropOut = mixer.clipAction(clip("Grab_DropOut", 0.6));
  const struggleHeld = mixer.clipAction(clip("Struggle_Held", 1.2));
  const struggleAir = mixer.clipAction(clip("Struggle_Air", 1.2));
  const actions = {
    idle: null, walk: null, run: null, sprint: null,
    jumpStart: null, jumpRise: null, jumpApex: null, jumpFall: null, jumpLand: null,
    punch: null, hitReact: null,
    ko: { F: null, FL: null, FR: null, B: null, BL: null, BR: null },
    getUp: { F: null, FL: null, FR: null, B: null, BL: null, BR: null },
    death: { F: null, FL: null, FR: null, B: null, BL: null, BR: null },
    grabReach, grabPull, grabHold, grabDropOut, struggleHeld, struggleAir,
    wobble: null, wobbleWalk: null,
  } satisfies CharacterActions;
  return { actions, grabReach, grabPull, grabHold, grabDropOut, struggleHeld, struggleAir };
};

/** A pose as `[action, time]`, times rounded so float noise doesn't matter. */
const at = (pose: ClipPose | null) => (pose ? [pose.action, Math.round(pose.time * 1000) / 1000] : null);

describe("grabRoleOf", () => {
  it("reads both ends of a hold off state that is already replicated", () => {
    expect(grabRoleOf("them", null)).toBe("grabbing");
    expect(grabRoleOf(null, "them")).toBe("held");
    expect(grabRoleOf(null, null)).toBe("free");
  });
});

describe("grabHoldPoseAt", () => {
  it("plays the hold in its authored order: reach, pull, then the hold, looping", () => {
    const { actions, grabReach, grabPull, grabHold } = rig();
    expect(at(grabHoldPoseAt(0, actions))).toEqual([grabReach, 0]);
    expect(at(grabHoldPoseAt(0.5, actions))).toEqual([grabReach, 0.5]);
    expect(at(grabHoldPoseAt(0.8, actions))).toEqual([grabPull, 0.13]);
    expect(at(grabHoldPoseAt(1.2, actions))).toEqual([grabHold, 0.06]);
    // …and loops however long the hold lasts.
    expect(at(grabHoldPoseAt(1.14 + 60.25, actions))).toEqual([grabHold, 0.25]);
  });

  it("degrades to whatever the rig actually has", () => {
    const { actions, grabHold, grabPull } = rig();
    expect(at(grabHoldPoseAt(0, { ...actions, grabReach: null, grabPull: null }))).toEqual([grabHold, 0]);
    // No hold loop: rest on the pull's last frame.
    expect(at(grabHoldPoseAt(5, { ...actions, grabHold: null }))).toEqual([grabPull, 0.47]);
  });
});

describe("strugglePoseAt", () => {
  it("struggles differently on the ground and in the air, on a loop", () => {
    const { actions, struggleHeld, struggleAir } = rig();
    expect(at(strugglePoseAt(0, true, actions))).toEqual([struggleHeld, 0]);
    expect(at(strugglePoseAt(1.5, false, actions))).toEqual([struggleAir, 0.3]);
    expect(at(strugglePoseAt(0, false, { ...actions, struggleAir: null }))).toEqual([struggleHeld, 0]);
  });
});

describe("grabAttemptPoseAt", () => {
  it("reaches, lets go from arm's length, and is done", () => {
    const { actions, grabReach, grabDropOut } = rig();
    expect(at(grabAttemptPoseAt(0, actions))).toEqual([grabReach, 0]);
    expect(at(grabAttemptPoseAt(0.8, actions))).toEqual([grabDropOut, 0.13]);
    expect(grabAttemptPoseAt(0.67 + 0.6, actions)).toBeNull();
  });
});

describe("GrabAnimations", () => {
  it("draws nothing for a Character doing nothing — including the epoch it first sees", () => {
    const { actions } = rig();
    const grabs = new GrabAnimations();
    // Joining a match where this Character has grabbed five times before.
    expect(grabs.pose("a", "free", 5, true, 0, actions)).toBeNull();
    expect(grabs.pose("a", "free", 5, true, 100, actions)).toBeNull();
  });

  it("shows a grab at nobody — the reach and the let-go — then hands the body back", () => {
    const { actions, grabReach, grabDropOut } = rig();
    const grabs = new GrabAnimations();
    grabs.pose("a", "free", 0, true, 0, actions);
    expect(at(grabs.pose("a", "free", 1, true, 1000, actions))).toEqual([grabReach, 0]);
    expect(at(grabs.pose("a", "free", 1, true, 1500, actions))).toEqual([grabReach, 0.5]);
    expect(at(grabs.pose("a", "free", 1, true, 1800, actions))).toEqual([grabDropOut, 0.13]);
    expect(grabs.pose("a", "free", 1, true, 2300, actions)).toBeNull();
    expect(grabs.pose("a", "free", 1, true, 5000, actions)).toBeNull();
  });

  it("starts over when G is pressed again mid-attempt", () => {
    const { actions, grabReach } = rig();
    const grabs = new GrabAnimations();
    grabs.pose("a", "free", 0, true, 0, actions);
    grabs.pose("a", "free", 1, true, 0, actions);
    expect(at(grabs.pose("a", "free", 2, true, 900, actions))).toEqual([grabReach, 0]);
  });

  it("carries a predicted reach straight on into the hold the server confirms a round trip later", () => {
    const { actions, grabReach, grabPull } = rig();
    const grabs = new GrabAnimations();
    grabs.pose("local", "free", 0, true, 0, actions);
    grabs.pose("local", "free", 1, true, 1000, actions); // the press, predicted
    // The catch arrives 120 ms later: same reach, same frame — not a second one.
    expect(at(grabs.pose("local", "grabbing", 1, true, 1120, actions))).toEqual([grabReach, 0.12]);
    expect(at(grabs.pose("local", "grabbing", 1, true, 1800, actions))).toEqual([grabPull, 0.13]);
  });

  it("starts the hold from the reach when the attempt and the catch arrive together", () => {
    const { actions, grabReach } = rig();
    const grabs = new GrabAnimations();
    grabs.pose("b", "free", 0, true, 0, actions);
    expect(at(grabs.pose("b", "grabbing", 1, true, 3000, actions))).toEqual([grabReach, 0]);
  });

  it("starts a hold it never saw begin from the reach", () => {
    const { actions, grabReach, grabHold } = rig();
    const grabs = new GrabAnimations();
    expect(at(grabs.pose("b", "grabbing", 3, true, 0, actions))).toEqual([grabReach, 0]);
    expect(grabs.pose("b", "grabbing", 3, true, 1500, actions)!.action).toBe(grabHold);
  });

  it("lets go cleanly — no leftover reach once a hold ends", () => {
    const { actions } = rig();
    const grabs = new GrabAnimations();
    grabs.pose("a", "free", 0, true, 0, actions);
    grabs.pose("a", "grabbing", 1, true, 0, actions);
    expect(grabs.pose("a", "free", 1, true, 300, actions)).toBeNull();
  });

  it("struggles while held", () => {
    const { actions, struggleHeld, struggleAir } = rig();
    const grabs = new GrabAnimations();
    grabs.pose("a", "free", 0, true, 0, actions);
    expect(grabs.pose("a", "held", 0, true, 100, actions)!.action).toBe(struggleHeld);
    expect(grabs.pose("a", "held", 0, false, 200, actions)!.action).toBe(struggleAir);
  });

  it("times each Character on its own, and forgets one on request", () => {
    const { actions, grabReach } = rig();
    const grabs = new GrabAnimations();
    grabs.pose("a", "free", 0, true, 0, actions);
    grabs.pose("b", "free", 0, true, 0, actions);
    grabs.pose("a", "free", 1, true, 0, actions);
    expect(grabs.pose("b", "free", 0, true, 100, actions)).toBeNull();
    expect(at(grabs.pose("a", "free", 1, true, 100, actions))).toEqual([grabReach, 0.1]);

    grabs.forget("a");
    // Forgotten: the next sighting is a fresh baseline, not an attempt.
    expect(grabs.pose("a", "free", 7, true, 200, actions)).toBeNull();
  });
});
