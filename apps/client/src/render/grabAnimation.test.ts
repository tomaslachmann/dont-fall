import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GRAB_TURN_SPEED_MULTIPLIER, PICKUP_CLIP_SECONDS, PROP_LIFT_SPEEDUP, PROP_CARRY_MASS_MAX, propCarryTurn } from "@dont-fall/shared";
import {
  GrabAnimations,
  grabAttemptPoseAt,
  grabHoldPoseAt,
  grabReleasePoseAt,
  grabRoleOf,
  limpPoseAt,
  localHoldOf,
  propCarryPoseAt,
  type PropCarryFrame,
  NO_HOLD,
  NO_PROP_CARRY,
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
  const grabHold = mixer.clipAction(clip("Grab_HoldOut", 1));
  const grabDropOut = mixer.clipAction(clip("Grab_DropOut", 0.6));
  const struggleHeld = mixer.clipAction(clip("Struggle_Held", 1.2));
  const struggleAir = mixer.clipAction(clip("Struggle_Air", 1.2));
  const koBack = mixer.clipAction(clip("KO_B", 0.9));
  const actions = {
    idle: null, walk: null, run: null, sprint: null,
    jumpStart: null, jumpRise: null, jumpApex: null, jumpFall: null, jumpLand: null,
    punch: null, hitReact: null,
    ko: { F: null, FL: null, FR: null, B: koBack, BL: null, BR: null },
    getUp: { F: null, FL: null, FR: null, B: null, BL: null, BR: null },
    death: { F: null, FL: null, FR: null, B: null, BL: null, BR: null },
    grabReach, grabHold, grabDropOut, struggleHeld, struggleAir,
    wobble: null, wobbleWalk: null, pickup: null, carryWalk: null, throwItem: null,
  } satisfies CharacterActions;
  return { actions, grabReach, grabHold, grabDropOut, struggleHeld, struggleAir, koBack };
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
  it("plays the hold in its authored order: reach, then the arms-out hold, looping", () => {
    const { actions, grabReach, grabHold } = rig();
    expect(at(grabHoldPoseAt(0, actions))).toEqual([grabReach, 0]);
    expect(at(grabHoldPoseAt(0.5, actions))).toEqual([grabReach, 0.5]);
    expect(at(grabHoldPoseAt(0.8, actions))).toEqual([grabHold, 0.13]);
    // …and loops however long the hold lasts.
    expect(at(grabHoldPoseAt(0.67 + 60.25, actions))).toEqual([grabHold, 0.25]);
  });

  it("degrades to whatever the rig actually has", () => {
    const { actions, grabHold, grabReach } = rig();
    expect(at(grabHoldPoseAt(0, { ...actions, grabReach: null }))).toEqual([grabHold, 0]);
    // No hold loop: rest on the reach's last frame.
    expect(at(grabHoldPoseAt(5, { ...actions, grabHold: null }))).toEqual([grabReach, 0.67]);
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

describe("grabReleasePoseAt", () => {
  it("brings the arms back in from arm's length, and is done", () => {
    const { actions, grabDropOut } = rig();
    expect(at(grabReleasePoseAt(0.13, actions))).toEqual([grabDropOut, 0.13]);
    expect(grabReleasePoseAt(0.7, actions)).toBeNull();
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
    const { actions, grabReach, grabHold } = rig();
    const grabs = new GrabAnimations();
    grabs.pose("local", "free", 0, true, 0, actions);
    grabs.pose("local", "free", 1, true, 1000, actions); // the press, predicted
    // The catch arrives 120 ms later: same reach, same frame — not a second one.
    expect(at(grabs.pose("local", "grabbing", 1, true, 1120, actions))).toEqual([grabReach, 0.12]);
    expect(at(grabs.pose("local", "grabbing", 1, true, 1800, actions))).toEqual([grabHold, 0.13]);
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

  it("plays its way out of a hold that ended — the arms come back in, then the body is handed back", () => {
    const { actions, grabDropOut } = rig();
    const grabs = new GrabAnimations();
    grabs.pose("a", "free", 0, true, 0, actions);
    grabs.pose("a", "grabbing", 1, true, 0, actions);
    expect(at(grabs.pose("a", "free", 1, true, 3000, actions))).toEqual([grabDropOut, 0]);
    expect(at(grabs.pose("a", "free", 1, true, 3300, actions))).toEqual([grabDropOut, 0.3]);
    expect(grabs.pose("a", "free", 1, true, 3700, actions)).toBeNull();
    expect(grabs.pose("a", "free", 1, true, 9000, actions)).toBeNull();
  });

  it("lets a fresh attempt outrank the release tail — a re-grab reaches, it doesn't wave goodbye", () => {
    const { actions, grabReach } = rig();
    const grabs = new GrabAnimations();
    grabs.pose("a", "free", 0, true, 0, actions);
    grabs.pose("a", "grabbing", 1, true, 0, actions);
    // The hold ends on the same frame a new attempt fires (epoch 2).
    expect(at(grabs.pose("a", "free", 2, true, 3000, actions))).toEqual([grabReach, 0]);
  });

  it("gives a freed held Character no tail — it is back on its feet, not letting go of anyone", () => {
    const { actions } = rig();
    const grabs = new GrabAnimations();
    grabs.pose("a", "free", 0, true, 0, actions);
    grabs.pose("a", "held", 0, true, 100, actions);
    expect(grabs.pose("a", "free", 0, true, 2000, actions)).toBeNull();
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

describe("the hold drawn from the local Character's own end (ADR 0104)", () => {
  const server = (
    fields: Partial<{
      grabbingId: string | null;
      carryingProp: number | null;
      heldByGrabberId: string | null;
      heldPhase: "struggle" | "limp" | null;
      facing: number;
      liftMs: number | null;
      tossMs: number | null;
    }>,
  ) => ({
    grabbingId: null,
    carryingProp: null,
    heldByGrabberId: null,
    heldPhase: null,
    facing: 0.3,
    liftMs: null,
    tossMs: null,
    ...fields,
  });
  const predicted = (spinMs: number, facing: number, tossMs: number | null = null) => ({ spinMs, facing, tossMs, walking: false });

  it("pins a Held body to the facing the server gives it, and says which part of the hold it is in", () => {
    expect(localHoldOf(server({ heldByGrabberId: "g", heldPhase: "limp", facing: 2 }), predicted(0, -1))).toEqual({
      role: "held",
      phase: "limp",
      pinnedFacing: 2,
      turnScale: 1,
      carry: NO_PROP_CARRY,
    });
  });

  it("pins a Spinning grabber to the predicted facing, and leaves one only carrying to turn itself", () => {
    expect(localHoldOf(server({ grabbingId: "h" }), predicted(200, 1.4)).pinnedFacing).toBe(1.4);
    expect(localHoldOf(server({ grabbingId: "h" }), predicted(0, 1.4))).toEqual({
      role: "grabbing",
      phase: null,
      pinnedFacing: null,
      turnScale: GRAB_TURN_SPEED_MULTIPLIER,
      carry: NO_PROP_CARRY,
    });
  });

  it("carries a Prop as a hold, turning slower the heavier it is (ADR 0125)", () => {
    const light = localHoldOf(server({ carryingProp: 2 }), predicted(0, 0), 1.5);
    const heavy = localHoldOf(server({ carryingProp: 2 }), predicted(0, 0), PROP_CARRY_MASS_MAX);

    expect(light.role).toBe("grabbing");
    expect(light.turnScale).toBe(propCarryTurn(1.5));
    expect(heavy.turnScale).toBeLessThan(light.turnScale);
  });

  it("is no hold at all before the server world has drawn anything", () => {
    expect(localHoldOf(undefined, predicted(0, 0))).toBe(NO_HOLD);
  });

  it("collapses a Limp body backwards and hangs it on the knockdown's last frame", () => {
    const { actions, koBack } = rig();
    expect(at(limpPoseAt(0.3, actions))).toEqual([koBack, 0.3]);
    expect(at(limpPoseAt(10, actions))).toEqual([koBack, 0.9]);
  });

  it("switches a held body from kicking to Limp the moment it goes Limp, from that moment's own clock", () => {
    const { actions, struggleAir, koBack } = rig();
    const grabs = new GrabAnimations();
    expect(at(grabs.pose("x", "held", 0, false, 0, actions))).toEqual([struggleAir, 0]);
    expect(at(grabs.pose("x", "held", 0, false, 2000, actions, true))).toEqual([koBack, 0]);
    expect(at(grabs.pose("x", "held", 0, false, 2500, actions, true))).toEqual([koBack, 0.5]);
  });
});

describe("carrying a Prop (ADR 0128)", () => {
  const carryRig = () => {
    const base = rig();
    const mixer = new THREE.AnimationMixer(new THREE.Object3D());
    const pickup = mixer.clipAction(clip("Pickup_Ground", PICKUP_CLIP_SECONDS));
    const carryWalk = mixer.clipAction(clip("Carry_Walk", 1.2));
    const throwItem = mixer.clipAction(clip("Throw_Item", 1.2));
    return { ...base, actions: { ...base.actions, pickup, carryWalk, throwItem }, pickup, carryWalk, throwItem };
  };
  const frame = (fields: Partial<PropCarryFrame> = {}): PropCarryFrame => ({ ...NO_PROP_CARRY, prop: true, ...fields });

  it("counts a Lift as a hold before the hands have even reached the Prop", () => {
    expect(grabRoleOf(null, null, null, true)).toBe("grabbing");
  });

  it("plays the Lift sped up from its replicated start, and holds on its last frame once up", () => {
    const { actions, pickup } = carryRig();
    const into = 400;
    expect(at(propCarryPoseAt(frame({ liftMs: into }), 0, 0, actions))).toEqual([pickup, Math.round(into * PROP_LIFT_SPEEDUP) / 1000]);
    expect(at(propCarryPoseAt(frame({ liftMs: 60_000 }), 0, 0, actions))).toEqual([pickup, PICKUP_CLIP_SECONDS]);
    // Standing still, or in the air: the hold is that last frame.
    expect(at(propCarryPoseAt(frame(), 0, 3, actions))).toEqual([pickup, PICKUP_CLIP_SECONDS]);
  });

  it("walks with it, winds a Toss up, and Spins it at arm's length", () => {
    const { actions, carryWalk, throwItem, grabHold } = carryRig();
    expect(at(propCarryPoseAt(frame({ walking: true }), 1.5, 9, actions))).toEqual([carryWalk, 0.3]);
    expect(at(propCarryPoseAt(frame({ tossMs: 250, walking: true }), 0, 0, actions))).toEqual([throwItem, 0.25]);
    expect(at(propCarryPoseAt(frame({ spinning: true, walking: true }), 0, 2.25, actions))).toEqual([grabHold, 0.25]);
  });

  it("plays the rest of a Toss on after the Prop has gone, until it ends or its carrier walks off", () => {
    const { actions, throwItem } = carryRig();
    const grabs = new GrabAnimations();
    grabs.pose("a", "grabbing", 1, true, 0, actions, false, frame({ tossMs: 300 }));
    // Let go: carrying nothing any more, the clip carries on from 0.3 s.
    expect(at(grabs.pose("a", "free", 1, true, 100, actions))).toEqual([throwItem, 0.4]);
    expect(at(grabs.pose("a", "free", 1, true, 600, actions))).toEqual([throwItem, 0.9]);
    expect(grabs.pose("a", "free", 1, true, 1000, actions)).toBeNull();

    grabs.pose("b", "grabbing", 1, true, 0, actions, false, frame({ tossMs: 300 }));
    expect(grabs.pose("b", "free", 1, true, 100, actions, false, { ...NO_PROP_CARRY, walking: true })).toBeNull();
  });

  it("stands the local body still while it Lifts or winds up, and the Toss the moment it is predicted", () => {
    const server = {
      grabbingId: null,
      carryingProp: 0,
      heldByGrabberId: null,
      heldPhase: null,
      facing: 0,
      liftMs: null,
      tossMs: null,
    };
    const still = { spinMs: 0, facing: 0, tossMs: null, walking: false };
    expect(localHoldOf({ ...server, carryingProp: null, liftMs: 100 }, still, 2).turnScale).toBe(0);
    expect(localHoldOf(server, { ...still, tossMs: 0 }, 2).turnScale).toBe(0);
    expect(localHoldOf(server, still, 2).turnScale).toBeGreaterThan(0);
  });
});
