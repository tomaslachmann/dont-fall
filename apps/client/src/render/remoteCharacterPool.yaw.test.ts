// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { SPIN_MAX_SPEED, TICK_MS, wrapAngle, type RenderCharacter } from "@dont-fall/shared";
import { MODEL_YAW_OFFSET } from "./characterModel.js";
import { createRemoteCharacterPool } from "./remoteCharacterPool.js";

/** A rig with Idle and Run clips (empty tracks: only the root's turn matters here). */
const fakeModel = () => {
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
  return {
    scene,
    animations: [new THREE.AnimationClip("Idle", 1, []), new THREE.AnimationClip("Run", 0.8, [])],
  };
};

const running = (overrides: Partial<RenderCharacter> = {}): RenderCharacter => ({
  position: { x: 3, y: 1, z: 0 },
  bones: [],
  motionState: "Controlled",
  facing: 0,
  velocity: { x: 0, y: 0, z: -6 },
  grounded: true,
  dashing: false,
  dashSpeed: 0,
  respawnCount: 0,
  eliminated: false,
  hitChargeMs: 0,
  ragdollEpoch: 0,
  ragdollCause: "Fall",
  hitEpoch: 0,
  hitReactEpoch: 0,
  grabEpoch: 0,
  launchPadEpoch: 0,
  grabbingId: null,
  heldByGrabberId: null,
  heldPhase: null,
  spinMs: 0,
  ...overrides,
});

const FRAME = 1 / 60;
const TURN = 3; // rad/s
const ME = { x: 0, y: 0, z: 0 };
const UP = new THREE.Vector3(0, 1, 0);

/** The rig orientation that draws `facing` exactly (ADR 0045, with the rig's forward correction). */
const exactly = (facing: number) => new THREE.Quaternion().setFromAxisAngle(UP, Math.PI + MODEL_YAW_OFFSET - facing);

/** The facing a rig root is drawn at, read off its whole orientation (never its Euler angles). */
const drawnFacing = (root: THREE.Object3D) => {
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(root.quaternion);
  return wrapAngle(Math.PI + MODEL_YAW_OFFSET - Math.atan2(forward.x, forward.z));
};

const rigs = (scene: THREE.Scene) => scene.children;

describe("RemoteCharacterPool yaw (ADR 0109)", () => {
  it("keeps a rig turning through a Tick the server ran on a repeated input", () => {
    const scene = new THREE.Scene();
    const pool = createRemoteCharacterPool(scene, fakeModel());
    // One facing per Tick, interpolated between; Tick 30 repeats Tick 29's.
    const perTick = (tick: number) => (TURN * (tick === 30 ? 29 : tick) * TICK_MS) / 1000;
    const facingAt = (ms: number) => {
      const tick = Math.floor(ms / TICK_MS);
      return perTick(tick) + (perTick(tick + 1) - perTick(tick)) * ((ms - tick * TICK_MS) / TICK_MS);
    };
    const rates: number[] = [];
    let previous: number | null = null;
    for (let frame = 0; frame < 120; frame += 1) {
      pool.apply({ them: running({ facing: facingAt(frame * FRAME * 1000) }) }, FRAME, "me", ME);
      const drawn = drawnFacing(rigs(scene)[0]!);
      if (previous !== null && frame > 30) rates.push(wrapAngle(drawn - previous) / FRAME);
      previous = drawn;
    }
    // Raw, the rig would stand still for two frames and then turn at double speed.
    expect(Math.min(...rates)).toBeGreaterThan(0.25 * TURN);
    expect(Math.max(...rates)).toBeLessThan(1.6 * TURN);
    pool.dispose();
  });

  it("draws both ends of a hold at the facing exactly, every frame of a Spin", () => {
    const scene = new THREE.Scene();
    const pool = createRemoteCharacterPool(scene, fakeModel());
    // Both running and turning first, so each follow is behind its facing when the hold starts.
    for (let frame = 0; frame < 30; frame += 1) {
      const turned = TURN * frame * FRAME;
      pool.apply({ grabber: running({ facing: turned }), held: running({ facing: -turned }) }, FRAME, "me", ME);
    }
    const [grabberRig, heldRig] = rigs(scene);
    for (let frame = 0; frame < 45; frame += 1) {
      const facing = wrapAngle(1 + SPIN_MAX_SPEED * frame * FRAME);
      const heldFacing = wrapAngle(facing + Math.PI);
      pool.apply(
        {
          grabber: running({ facing, velocity: { x: 0, y: 0, z: 0 }, grabbingId: "held", spinMs: frame * FRAME * 1000 }),
          // Still, so its hang has no tilt and the root's orientation is its yaw alone.
          held: running({
            facing: heldFacing,
            velocity: { x: 0, y: 0, z: 0 },
            motionState: "Held",
            heldByGrabberId: "grabber",
            heldPhase: "limp",
          }),
        },
        FRAME,
        "me",
        ME,
      );
      expect(grabberRig!.quaternion.angleTo(exactly(facing))).toBeLessThan(1e-6);
      expect(heldRig!.quaternion.angleTo(exactly(heldFacing))).toBeLessThan(1e-6);
    }
    pool.dispose();
  });

  it("holds a knocked-down rig at the yaw it went down with, and turns it to the facing on the get-up", () => {
    const scene = new THREE.Scene();
    const pool = createRemoteCharacterPool(scene, fakeModel());
    for (let frame = 0; frame < 30; frame += 1) pool.apply({ them: running({ facing: 0.2 }) }, FRAME, "me", ME);
    const rig = rigs(scene)[0]!;
    const wentDown = rig.quaternion.clone();
    for (let frame = 0; frame < 60; frame += 1) {
      const motionState = frame < 40 ? "Ragdoll" : "GettingUp";
      pool.apply({ them: running({ facing: 0.2 + frame * 0.02, motionState, velocity: { x: 0, y: 0, z: 0 } }) }, FRAME, "me", ME);
      expect(rig.quaternion.angleTo(wentDown)).toBeLessThan(1e-6);
    }
    pool.apply({ them: running({ facing: 1.4, velocity: { x: 0, y: 0, z: 0 } }) }, FRAME, "me", ME);
    // On its way round, not there already.
    expect(drawnFacing(rig)).toBeGreaterThan(0.2);
    expect(drawnFacing(rig)).toBeLessThan(1.4);
    pool.dispose();
  });

  it("puts a body let go of into a knockdown down at the yaw it was held at", () => {
    // Its carried orientation is set whole, so its Euler angles are read back
    // off the quaternion — and past a quarter turn that reading carries π on
    // x and z, which zeroing used to turn into a mirrored yaw: here a rig
    // held at 2.84 rad went down at 0.30.
    const scene = new THREE.Scene();
    const pool = createRemoteCharacterPool(scene, fakeModel());
    const held = { facing: 0.3, velocity: { x: 0, y: 0, z: 0 } };
    for (let frame = 0; frame < 10; frame += 1) {
      pool.apply({ them: running({ ...held, motionState: "Held", heldByGrabberId: "grabber", heldPhase: "limp" }) }, FRAME, "me", ME);
    }
    pool.apply({ them: running({ ...held, motionState: "Ragdoll" }) }, FRAME, "me", ME);
    expect(rigs(scene)[0]!.quaternion.angleTo(exactly(0.3))).toBeLessThan(1e-6);
    pool.dispose();
  });

  it("snaps a rig to its facing on a Respawn", () => {
    const scene = new THREE.Scene();
    const pool = createRemoteCharacterPool(scene, fakeModel());
    for (let frame = 0; frame < 30; frame += 1) pool.apply({ them: running({ facing: TURN * frame * FRAME }) }, FRAME, "me", ME);
    pool.apply({ them: running({ facing: -2, respawnCount: 1, motionState: "Stagger" }) }, FRAME, "me", ME);
    expect(rigs(scene)[0]!.quaternion.angleTo(exactly(-2))).toBeLessThan(1e-6);
    pool.dispose();
  });

  it("snaps a Character that left and came back", () => {
    const scene = new THREE.Scene();
    const pool = createRemoteCharacterPool(scene, fakeModel());
    for (let frame = 0; frame < 30; frame += 1) pool.apply({ them: running({ facing: 0 }) }, FRAME, "me", ME);
    pool.apply({}, FRAME, "me", ME);
    pool.apply({ them: running({ facing: 2 }) }, FRAME, "me", ME);
    expect(rigs(scene)).toHaveLength(1);
    expect(rigs(scene)[0]!.quaternion.angleTo(exactly(2))).toBeLessThan(1e-6);
    pool.dispose();
  });
});
