// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { RenderCharacter } from "@dont-fall/shared";
import { createRemoteCharacterPool } from "./remoteCharacterPool.js";

const RUN_SECONDS = 0.8;

/** A rig with Idle and Run clips (empty tracks: only their clocks matter here). */
const fakeModel = () => {
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
  return {
    scene,
    animations: [new THREE.AnimationClip("Idle", 1, []), new THREE.AnimationClip("Run", RUN_SECONDS, [])],
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
  ...overrides,
});

const FRAME = 1 / 60;

describe("RemoteCharacterPool footsteps (M14 ticket 04)", () => {
  it("steps twice per Run stride, at the Character's position", () => {
    const onFootstep = vi.fn();
    const pool = createRemoteCharacterPool(new THREE.Scene(), fakeModel(), { onFootstep });
    // Long enough for the Run to fade in and cover four strides.
    const frames = Math.round((4 * RUN_SECONDS) / FRAME);
    for (let frame = 0; frame < frames; frame += 1) pool.apply({ them: running() }, FRAME, "me", { x: 0, y: 0, z: 0 });
    expect(onFootstep.mock.calls.length).toBeGreaterThanOrEqual(7);
    expect(onFootstep.mock.calls.length).toBeLessThanOrEqual(8);
    expect(onFootstep).toHaveBeenCalledWith("run", { x: 3, y: 1, z: 0 });
    pool.dispose();
  });

  it("is silent in the air and while Sliding", () => {
    const onFootstep = vi.fn();
    const pool = createRemoteCharacterPool(new THREE.Scene(), fakeModel(), { onFootstep });
    for (let frame = 0; frame < 120; frame += 1) pool.apply({ them: running({ grounded: false }) }, FRAME, "me", { x: 0, y: 0, z: 0 });
    for (let frame = 0; frame < 120; frame += 1) pool.apply({ them: running({ motionState: "Sliding" }) }, FRAME, "me", { x: 0, y: 0, z: 0 });
    expect(onFootstep).not.toHaveBeenCalled();
    pool.dispose();
  });

  it("stops the moment the Character stands still", () => {
    const onFootstep = vi.fn();
    const pool = createRemoteCharacterPool(new THREE.Scene(), fakeModel(), { onFootstep });
    for (let frame = 0; frame < 60; frame += 1) pool.apply({ them: running() }, FRAME, "me", { x: 0, y: 0, z: 0 });
    const steps = onFootstep.mock.calls.length;
    for (let frame = 0; frame < 120; frame += 1) {
      pool.apply({ them: running({ velocity: { x: 0, y: 0, z: 0 } }) }, FRAME, "me", { x: 0, y: 0, z: 0 });
    }
    expect(onFootstep.mock.calls.length).toBe(steps);
    pool.dispose();
  });
});
