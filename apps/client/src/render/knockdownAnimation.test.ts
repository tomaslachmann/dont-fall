import { CAPSULE_BOTTOM_OFFSET, type CharacterMotionState, type Vec3 } from "@dont-fall/shared";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { KNOCKDOWN_DIRECTIONS, RAGDOLL_PELVIS_TO_FEET, type CharacterActions, type KnockdownDirection } from "./characterModel.js";
import {
  KNOCKDOWN_FALLBACK,
  KNOCKDOWN_ORIGIN_EASE_SECONDS,
  KNOCKDOWN_PICK_SECONDS,
  KnockdownOrigin,
  Knockdowns,
  knockdownDirection,
  knockdownFeetY,
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
    grabReach: null, grabPull: null, grabHold: null, grabDropOut: null,
    struggleHeld: null, struggleAir: null, wobble: null, wobbleWalk: null,
  };
};

const UNTURNED = new THREE.Quaternion();
const yawed = (radians: number): THREE.Quaternion => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), radians);
/** A horizontal push `degrees` clockwise from the model's forward (+Z) toward its +X. */
const pushAt = (degrees: number, speed = 5): Vec3 => {
  const r = (degrees * Math.PI) / 180;
  return { x: Math.sin(r) * speed, y: 0, z: Math.cos(r) * speed };
};

const frame = (motionState: CharacterMotionState, overrides: Partial<KnockdownFrame> = {}): KnockdownFrame => ({
  motionState,
  velocity: { x: 0, y: 0, z: 0 },
  modelQuaternion: UNTURNED,
  busy: false,
  deltaSeconds: 1 / 60,
  ...overrides,
});

const clipName = (pose: { action: THREE.AnimationAction } | null): string | null => pose?.action.getClip().name ?? null;

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

describe("Knockdowns", () => {
  it("plays KO the way it was pushed from the first down frame, and rests on its last frame", () => {
    const actions = rig();
    const knockdowns = new Knockdowns();
    const first = knockdowns.advance("a", frame("Ragdoll", { velocity: pushAt(60) }), actions);
    expect(clipName(first)).toBe("KO_FR");
    expect(first!.time).toBe(0);

    const later = knockdowns.advance("a", frame("Ragdoll", { deltaSeconds: 0.5, velocity: pushAt(200) }), actions);
    expect(clipName(later)).toBe("KO_FR");
    expect(later!.time).toBeCloseTo(0.5);

    const held = knockdowns.advance("a", frame("Ragdoll", { deltaSeconds: 3 }), actions);
    expect(held!.time).toBeCloseTo(KO_SECONDS);
  });

  it("falls back with no push, and still takes a push that turns up in the first moments", () => {
    const actions = rig();
    const knockdowns = new Knockdowns();
    expect(clipName(knockdowns.advance("a", frame("Ragdoll"), actions))).toBe(`KO_${KNOCKDOWN_FALLBACK}`);
    expect(clipName(knockdowns.advance("a", frame("Ragdoll", { deltaSeconds: 0.03, velocity: pushAt(0) }), actions))).toBe("KO_F");

    const late = new Knockdowns();
    late.advance("a", frame("Ragdoll"), actions);
    late.advance("a", frame("Ragdoll", { deltaSeconds: KNOCKDOWN_PICK_SECONDS + 0.05 }), actions);
    expect(clipName(late.advance("a", frame("Ragdoll", { velocity: pushAt(0) }), actions))).toBe(`KO_${KNOCKDOWN_FALLBACK}`);
  });

  it("gets up the way it fell, from GetUp's first frame, the moment GettingUp is drawn", () => {
    const actions = rig();
    const knockdowns = new Knockdowns();
    knockdowns.advance("a", frame("Ragdoll", { velocity: pushAt(240) }), actions);
    knockdowns.advance("a", frame("Ragdoll", { deltaSeconds: 2 }), actions);
    const up = knockdowns.advance("a", frame("GettingUp", { deltaSeconds: 0.2 }), actions);
    expect(clipName(up)).toBe("GetUp_BL");
    expect(up!.time).toBe(0);
    expect(knockdowns.advance("a", frame("GettingUp", { deltaSeconds: 0.25 }), actions)!.time).toBeCloseTo(0.25);
  });

  it("plays the rest of the get-up back in Controlled while standing still, then lets go", () => {
    const actions = rig();
    const knockdowns = new Knockdowns();
    knockdowns.advance("a", frame("Ragdoll", { velocity: pushAt(0) }), actions);
    knockdowns.advance("a", frame("GettingUp"), actions);
    knockdowns.advance("a", frame("GettingUp", { deltaSeconds: 1 }), actions);
    const tail = knockdowns.advance("a", frame("Controlled", { deltaSeconds: 0.5 }), actions);
    expect(clipName(tail)).toBe("GetUp_F");
    expect(tail!.time).toBeCloseTo(1.5);
    expect(knockdowns.has("a")).toBe(true);

    expect(knockdowns.advance("a", frame("Controlled", { deltaSeconds: GETUP_SECONDS }), actions)).toBeNull();
    expect(knockdowns.has("a")).toBe(false);
  });

  it("hands the body back the moment the Player does anything in the tail", () => {
    const actions = rig();
    const knockdowns = new Knockdowns();
    knockdowns.advance("a", frame("Ragdoll"), actions);
    knockdowns.advance("a", frame("GettingUp"), actions);
    expect(knockdowns.advance("a", frame("Controlled", { busy: true }), actions)).toBeNull();
    expect(knockdowns.has("a")).toBe(false);
    // …and stays gone once standing still again.
    expect(knockdowns.advance("a", frame("Controlled"), actions)).toBeNull();
  });

  it("lets a Wobble take the tail", () => {
    const actions = rig();
    const knockdowns = new Knockdowns();
    knockdowns.advance("a", frame("Ragdoll"), actions);
    knockdowns.advance("a", frame("GettingUp"), actions);
    expect(knockdowns.advance("a", frame("Stagger"), actions)).toBeNull();
  });

  it("drops a fall a correction undid, straight from Ragdoll to Controlled", () => {
    const actions = rig();
    const knockdowns = new Knockdowns();
    knockdowns.advance("a", frame("Ragdoll", { velocity: pushAt(0) }), actions);
    expect(knockdowns.advance("a", frame("Controlled"), actions)).toBeNull();
    expect(knockdowns.has("a")).toBe(false);
  });

  it("gets up the fallback way when the fall was never drawn", () => {
    const actions = rig();
    const knockdowns = new Knockdowns();
    const up = knockdowns.advance("a", frame("GettingUp", { velocity: pushAt(60) }), actions);
    expect(clipName(up)).toBe(`GetUp_${KNOCKDOWN_FALLBACK}`);
    expect(up!.time).toBe(0);
  });

  it("starts over for a new fall, or a new get-up, landing during the last one's tail", () => {
    const actions = rig();
    const knockdowns = new Knockdowns();
    knockdowns.advance("a", frame("Ragdoll", { velocity: pushAt(0) }), actions);
    knockdowns.advance("a", frame("GettingUp"), actions);
    knockdowns.advance("a", frame("Controlled", { deltaSeconds: 1.5 }), actions);
    const again = knockdowns.advance("a", frame("Ragdoll", { velocity: pushAt(180) }), actions);
    expect(clipName(again)).toBe("KO_B");
    expect(again!.time).toBe(0);

    const other = new Knockdowns();
    other.advance("b", frame("Ragdoll", { velocity: pushAt(0) }), actions);
    other.advance("b", frame("GettingUp"), actions);
    other.advance("b", frame("Controlled", { deltaSeconds: 1.5 }), actions);
    const up = other.advance("b", frame("GettingUp"), actions);
    expect(clipName(up)).toBe(`GetUp_${KNOCKDOWN_FALLBACK}`);
    expect(up!.time).toBe(0);
  });

  it("keeps each Character's knockdown apart, and forgets on request", () => {
    const actions = rig();
    const knockdowns = new Knockdowns();
    knockdowns.advance("a", frame("Ragdoll", { velocity: pushAt(0) }), actions);
    knockdowns.advance("b", frame("Ragdoll", { velocity: pushAt(180) }), actions);
    expect(clipName(knockdowns.advance("a", frame("Ragdoll"), actions))).toBe("KO_F");
    expect(clipName(knockdowns.advance("b", frame("Ragdoll"), actions))).toBe("KO_B");
    knockdowns.forget("a");
    expect(knockdowns.has("a")).toBe(false);
    expect(knockdowns.has("b")).toBe(true);
    knockdowns.reset();
    expect(knockdowns.has("b")).toBe(false);
  });

  it("draws nothing for a rig without the clips", () => {
    const actions = { ...rig(), ko: { F: null, FL: null, FR: null, B: null, BL: null, BR: null } };
    expect(new Knockdowns().advance("a", frame("Ragdoll", { velocity: pushAt(0) }), actions)).toBeNull();
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
