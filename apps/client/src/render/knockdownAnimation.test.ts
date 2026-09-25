import {
  BLIP_RAGDOLL_SPEC,
  CAPSULE_BOTTOM_OFFSET,
  GETUP_DRIVE_MS,
  mulQuat,
  rotateVec3ByQuat,
  yawQuat,
  type BoneSnapshot,
  type CharacterMotionState,
  type Vec3,
} from "@dont-fall/shared";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { KNOCKDOWN_DIRECTIONS, RAGDOLL_PELVIS_TO_FEET, type CharacterActions, type KnockdownDirection } from "./characterModel.js";
import {
  KNOCKDOWN_ORIGIN_EASE_SECONDS,
  KnockdownOrigin,
  Knockdowns,
  knockdownDirection,
  knockdownFeetY,
  type KnockdownDraw,
  type KnockdownFrame,
} from "./knockdownAnimation.js";

const KO_SECONDS = 50 / 30;
const GETUP_SECONDS = 84 / 30;

/** A rig with BLIP's knockdown clips at their real lengths (v6), and nothing else. */
const rig = (): CharacterActions => {
  const mixer = new THREE.AnimationMixer(new THREE.Object3D());
  const clip = (name: string, d: number) =>
    mixer.clipAction(new THREE.AnimationClip(name, d, [new THREE.VectorKeyframeTrack(".position", [0, d], [0, 0, 0, 0, 0, 0])]));
  const byDirection = (make: (d: KnockdownDirection) => THREE.AnimationAction | null) =>
    Object.fromEntries(KNOCKDOWN_DIRECTIONS.map((d) => [d, make(d)])) as Record<KnockdownDirection, THREE.AnimationAction | null>;
  return {
    idle: null, walk: null, run: null, sprint: null,
    jumpStart: null, jumpRise: null, jumpApex: null, jumpFall: null, jumpLand: null,
    punch: null, hitReact: null,
    ko: byDirection((d) => clip(`KO_${d}`, KO_SECONDS)),
    getUp: byDirection((d) => clip(`GetUp_${d}`, GETUP_SECONDS)),
    death: byDirection(() => null),
    grabReach: null, grabHold: null, grabDropOut: null,
    struggleHeld: null, struggleAir: null, wobble: null, wobbleWalk: null, pickup: null, carryWalk: null, throwItem: null,
  };
};

const UNTURNED = new THREE.Quaternion();
const yawed = (radians: number): THREE.Quaternion => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), radians);
/** A horizontal push `degrees` clockwise from the model's forward (+Z) toward its +X. */
const pushAt = (degrees: number, speed = 5): Vec3 => {
  const r = (degrees * Math.PI) / 180;
  return { x: Math.sin(r) * speed, y: 0, z: Math.cos(r) * speed };
};

/** The baked get-up pose, placed: what the simulation's sweep leaves behind. */
const swept = (side: "F" | "B", yaw = 0, x = 0, z = 0): BoneSnapshot[] => {
  const facing = yawQuat(yaw);
  return BLIP_RAGDOLL_SPEC.getUp[side].bones.map((bone) => {
    const turned = rotateVec3ByQuat(bone.position, facing);
    return { position: { x: turned.x + x, y: turned.y, z: turned.z + z }, rotation: mulQuat(facing, bone.rotation) };
  });
};

/** A mid-fall heap: anything with bones in it, which is all the fall's drawing needs. */
const HEAP: BoneSnapshot[] = swept("B", 0.4);

const frame = (motionState: CharacterMotionState, overrides: Partial<KnockdownFrame> = {}): KnockdownFrame => ({
  motionState,
  velocity: { x: 0, y: 0, z: 0 },
  modelQuaternion: UNTURNED,
  bones: HEAP,
  busy: false,
  deltaSeconds: 1 / 60,
  ...overrides,
});

const SWEEP_SECONDS = GETUP_DRIVE_MS / 1000;
/**
 * Enter GettingUp and sit out the sweep, ending on `bones` — the pose the
 * simulation's sweep left behind. The entering frame starts the sweep's own
 * clock at zero, so the wait is a frame of its own.
 */
const sweepThrough = (
  knockdowns: Knockdowns,
  actions: CharacterActions,
  bones: BoneSnapshot[],
  id = "a",
): KnockdownDraw | null => {
  knockdowns.advance(id, frame("GettingUp", { bones }), actions);
  return knockdowns.advance(id, frame("GettingUp", { deltaSeconds: SWEEP_SECONDS, bones }), actions);
};
const clipName = (draw: KnockdownDraw | null): string | null =>
  draw?.kind === "clip" ? draw.pose.action.getClip().name : null;
const clipTime = (draw: KnockdownDraw | null): number | null => (draw?.kind === "clip" ? draw.pose.time : null);
const landingOf = (draw: KnockdownDraw | null) => (draw?.kind === "clip" ? draw.landing : null);

describe("knockdownDirection", () => {
  it("falls the way it was pushed, one fall every 60° clockwise from forward", () => {
    expect([0, 60, 120, 180, 240, 300].map((d) => knockdownDirection(pushAt(d), UNTURNED))).toEqual([
      "F", "FR", "BR", "B", "BL", "FL",
    ]);
  });

  it("gives each fall the 60° around it, lower edge inclusive, so a tie goes clockwise", () => {
    expect(knockdownDirection(pushAt(29.9), UNTURNED)).toBe("F");
    expect(knockdownDirection(pushAt(30), UNTURNED)).toBe("FR");
    expect(knockdownDirection(pushAt(89.9), UNTURNED)).toBe("FR");
    expect(knockdownDirection(pushAt(90), UNTURNED)).toBe("BR");
    expect(knockdownDirection(pushAt(329.9), UNTURNED)).toBe("FL");
    expect(knockdownDirection(pushAt(330), UNTURNED)).toBe("F");
    expect(knockdownDirection(pushAt(359.99), UNTURNED)).toBe("F");
  });

  it("reads the push in the model's own frame, however it is turned", () => {
    const turn = 1.1;
    // The model's forward in world space, then its +X side.
    expect(knockdownDirection({ x: Math.sin(turn), y: 0, z: Math.cos(turn) }, yawed(turn))).toBe("F");
    expect(knockdownDirection({ x: Math.cos(turn), y: 0, z: -Math.sin(turn) }, yawed(turn))).toBe("BR");
    expect(knockdownDirection({ x: -Math.sin(turn), y: 0, z: -Math.cos(turn) }, yawed(turn))).toBe("B");
  });

  it("has nothing to read from a push that is only vertical, or too slight", () => {
    expect(knockdownDirection({ x: 0, y: 12, z: 0 }, UNTURNED)).toBeNull();
    expect(knockdownDirection({ x: 0.01, y: 0, z: 0.01 }, UNTURNED)).toBeNull();
  });
});

describe("Knockdowns (.scratch/physical-ragdoll ticket 02/03)", () => {
  it("draws the fall from the bones, never a clip", () => {
    const actions = rig();
    const knockdowns = new Knockdowns();
    expect(knockdowns.advance("a", frame("Ragdoll", { velocity: pushAt(60) }), actions)).toEqual({ kind: "bones" });
    expect(knockdowns.advance("a", frame("Ragdoll", { deltaSeconds: 3 }), actions)).toEqual({ kind: "bones" });
  });

  it("keeps drawing bones through the get-up's sweep, then plays the clip the sweep landed on", () => {
    const actions = rig();
    const knockdowns = new Knockdowns();
    knockdowns.advance("a", frame("Ragdoll"), actions);
    // The sweep is the simulation's; the rig keeps drawing what it is doing.
    expect(knockdowns.advance("a", frame("GettingUp", { deltaSeconds: 0.2 }), actions)).toEqual({ kind: "bones" });
    expect(knockdowns.advance("a", frame("GettingUp", { deltaSeconds: SWEEP_SECONDS - 0.3 }), actions)).toEqual({ kind: "bones" });
    // Once it has ended, the clip starts at its own first frame, placed where
    // the bones were left.
    const landed = knockdowns.advance("a", frame("GettingUp", { deltaSeconds: 0.4, bones: swept("F", 1.2, 4, -3) }), actions);
    expect(clipName(landed)).toBe("GetUp_F");
    expect(clipTime(landed)).toBe(0);
    const landing = landingOf(landed);
    expect(landing?.yaw).toBeCloseTo(1.2, 4);
    expect(landing?.originX).toBeCloseTo(4, 4);
    expect(landing?.originZ).toBeCloseTo(-3, 4);
  });

  it("gets up the way the body actually lies — on its back or on its face", () => {
    const actions = rig();
    const toClip = (bones: BoneSnapshot[]): string | null => {
      const knockdowns = new Knockdowns();
      knockdowns.advance("a", frame("Ragdoll"), actions);
      return clipName(sweepThrough(knockdowns, actions, bones));
    };
    expect(toClip(swept("B"))).toBe("GetUp_B");
    expect(toClip(swept("F"))).toBe("GetUp_F");
  });

  it("runs the clip's own clock from the frame it starts", () => {
    const actions = rig();
    const knockdowns = new Knockdowns();
    knockdowns.advance("a", frame("Ragdoll"), actions);
    sweepThrough(knockdowns, actions, swept("B"));
    expect(clipTime(knockdowns.advance("a", frame("GettingUp", { deltaSeconds: 0.25 }), actions))).toBeCloseTo(0.25);
  });

  it("plays the rest of the get-up back in Controlled while standing still, then lets go", () => {
    const actions = rig();
    const knockdowns = new Knockdowns();
    knockdowns.advance("a", frame("Ragdoll"), actions);
    sweepThrough(knockdowns, actions, swept("F"));
    knockdowns.advance("a", frame("GettingUp", { deltaSeconds: 1 }), actions);
    const tail = knockdowns.advance("a", frame("Controlled", { deltaSeconds: 0.5 }), actions);
    expect(clipName(tail)).toBe("GetUp_F");
    expect(clipTime(tail)).toBeCloseTo(1.5);
    expect(knockdowns.has("a")).toBe(true);

    expect(knockdowns.advance("a", frame("Controlled", { deltaSeconds: GETUP_SECONDS }), actions)).toBeNull();
    expect(knockdowns.has("a")).toBe(false);
  });

  it("hands the body back the moment the Player does anything in the tail", () => {
    const actions = rig();
    const knockdowns = new Knockdowns();
    knockdowns.advance("a", frame("Ragdoll"), actions);
    sweepThrough(knockdowns, actions, swept("B"));
    expect(knockdowns.advance("a", frame("Controlled", { busy: true }), actions)).toBeNull();
    expect(knockdowns.has("a")).toBe(false);
    expect(knockdowns.advance("a", frame("Controlled"), actions)).toBeNull();
  });

  it("lets a Wobble take the tail", () => {
    const actions = rig();
    const knockdowns = new Knockdowns();
    knockdowns.advance("a", frame("Ragdoll"), actions);
    sweepThrough(knockdowns, actions, swept("B"));
    expect(knockdowns.advance("a", frame("Stagger"), actions)).toBeNull();
  });

  it("drops a fall a correction undid, straight from Ragdoll to Controlled", () => {
    const actions = rig();
    const knockdowns = new Knockdowns();
    knockdowns.advance("a", frame("Ragdoll"), actions);
    expect(knockdowns.advance("a", frame("Controlled"), actions)).toBeNull();
    expect(knockdowns.has("a")).toBe(false);
  });

  it("joins the clip at once for a rig that starts watching part-way through a get-up", () => {
    const actions = rig();
    const knockdowns = new Knockdowns();
    // Its sweep has been and gone; the bones it can see are already on the
    // clip's first frame, and they say which one and where.
    const up = knockdowns.advance("a", frame("GettingUp", { bones: swept("B", -0.8, 2, 2) }), actions);
    expect(clipName(up)).toBe("GetUp_B");
    expect(clipTime(up)).toBe(0);
    expect(landingOf(up)?.yaw).toBeCloseTo(-0.8, 4);
  });

  it("starts over for a new fall landing during the last one's tail", () => {
    const actions = rig();
    const knockdowns = new Knockdowns();
    knockdowns.advance("a", frame("Ragdoll"), actions);
    sweepThrough(knockdowns, actions, swept("B"));
    knockdowns.advance("a", frame("Controlled", { deltaSeconds: 1.5 }), actions);
    expect(knockdowns.advance("a", frame("Ragdoll"), actions)).toEqual({ kind: "bones" });
  });

  it("keeps each Character's knockdown apart, and forgets on request", () => {
    const actions = rig();
    const knockdowns = new Knockdowns();
    knockdowns.advance("a", frame("Ragdoll"), actions);
    knockdowns.advance("b", frame("Ragdoll"), actions);
    sweepThrough(knockdowns, actions, swept("F"), "a");
    sweepThrough(knockdowns, actions, swept("B"), "b");
    expect(clipName(knockdowns.advance("a", frame("GettingUp"), actions))).toBe("GetUp_F");
    expect(clipName(knockdowns.advance("b", frame("GettingUp"), actions))).toBe("GetUp_B");
    knockdowns.forget("a");
    expect(knockdowns.has("a")).toBe(false);
    expect(knockdowns.has("b")).toBe(true);
    knockdowns.reset();
    expect(knockdowns.has("b")).toBe(false);
  });

  it("falls back to the bones for a rig without the get-up clips", () => {
    const actions = { ...rig(), getUp: { F: null, FL: null, FR: null, B: null, BL: null, BR: null } };
    const knockdowns = new Knockdowns();
    knockdowns.advance("a", frame("Ragdoll"), actions);
    expect(sweepThrough(knockdowns, actions, swept("B"))).toEqual({ kind: "bones" });
  });
});

describe("knockdownFeetY", () => {
  it("stands the feet under the physics pelvis while down, and under the capsule while getting up", () => {
    expect(knockdownFeetY("Ragdoll", 2)).toBeCloseTo(2 - RAGDOLL_PELVIS_TO_FEET);
    expect(knockdownFeetY("GettingUp", 2)).toBeCloseTo(2 - CAPSULE_BOTTOM_OFFSET);
  });
});

describe("KnockdownOrigin", () => {
  it("stands on the floor while the feet would be under it, and follows the feet above it", () => {
    const origin = new KnockdownOrigin();
    expect(origin.place(1, 0.4, 0)).toBe(1);
    // Launched: the feet rise past the floor, and the rig goes with them, uneased.
    expect(origin.place(1, 1.15, 16)).toBe(1.15);
    expect(origin.place(1, 1.5, 32)).toBe(1.5);
    expect(origin.place(null, 1.2, 48)).toBe(1.2);
  });

  it("eases a step down onto a lower deck the same way", () => {
    const origin = new KnockdownOrigin();
    origin.place(0, -0.5, 0);
    expect(origin.place(-0.3, -0.5, 16)).toBeCloseTo(0, 6);
    expect(origin.place(-0.3, -0.5, 16 + KNOCKDOWN_ORIGIN_EASE_SECONDS * 5000)).toBeCloseTo(-0.3, 2);
  });

  it("eases a step off an edge instead of popping, and closes it on its own", () => {
    const origin = new KnockdownOrigin();
    origin.place(0, -0.5, 0);
    // The deck is gone from under it: the target drops to the feet at once…
    expect(origin.place(null, -0.5, 16)).toBeCloseTo(0, 6);
    // …and the drawn origin closes on it.
    const later = origin.place(null, -0.5, 16 + KNOCKDOWN_ORIGIN_EASE_SECONDS * 5000);
    expect(later).toBeCloseTo(-0.5, 2);
  });

  it("never eases a body already following physics through the air", () => {
    const origin = new KnockdownOrigin();
    origin.place(null, 3, 0);
    expect(origin.place(null, 2, 16)).toBe(2);
  });

  it("starts the next knockdown fresh after a reset", () => {
    const origin = new KnockdownOrigin();
    origin.place(0, -0.5, 0);
    origin.place(null, -0.5, 16);
    origin.reset();
    expect(origin.place(5, 4, 32)).toBe(5);
  });
});
