// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { CharacterMotionState, RenderCharacter, Vec3 } from "@dont-fall/shared";
import { NO_HOLD, type LocalHold } from "../grabAnimation.js";
import type { SkinCloset } from "../skins.js";
import type { Wardrobe } from "../hats.js";
import { modelYawFromFacing } from "../modelFacing.js";
import { createLocalCharacter, type LocalCharacter } from "./localCharacter.js";

/** A rig with Idle and Run clips (empty tracks: only the root's turn matters here). */
const fakeModel = () => {
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
  return { scene, animations: [new THREE.AnimationClip("Idle", 1, []), new THREE.AnimationClip("Run", 0.8, [])] };
};

const nothing: Wardrobe & SkinCloset = { wear: () => {}, dispose: () => {} };

const FRAME = 1 / 60;
const STILL: Vec3 = { x: 0, y: 0, z: 0 };
const UP = new THREE.Vector3(0, 1, 0);

const place = (local: LocalCharacter, motionState: CharacterMotionState, velocity = STILL) => {
  const character: RenderCharacter = {
    position: { x: 0, y: 1, z: 0 },
    bones: [],
    motionState,
    facing: 0,
    velocity,
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
    carryingProp: null,
    heldByGrabberId: null,
    heldPhase: null,
    spinMs: 0,
    liftMs: null,
    tossMs: null,
  };
  local.place(character);
};

const animate = (local: LocalCharacter, moveDirection: Vec3, grounded: boolean, hold: LocalHold) =>
  local.animate(FRAME, moveDirection, grounded, false, 0, 0, 0, 0, 0, hold);

describe("the local Character's facing through a carry (ADR 0109)", () => {
  // A carry sets the rig's orientation whole, and three.js reads its Euler
  // angles back off the quaternion with y in [−π/2, π/2]. Read back as the
  // heading, a body held at facing 0.3 sent 2.84 for the whole carry and was
  // let go of turned to that mirror, on its own screen and — being the facing
  // it sends (ADR 0085) — on the server's and every other.
  describe.each([0.3, -1.2, 2.5])("held at facing %f", (heldFacing) => {
    it.each(["on its feet", "hurled into a knockdown"] as const)(
      "sends the held facing through the carry, and after being let go of %s",
      (exit) => {
        const scene = new THREE.Scene();
        const local = createLocalCharacter(scene, fakeModel(), {
          floorBelow: () => null,
          inUpdraft: () => false,
          onIce: () => false,
          onFootstep: () => {},
          speedLines: { setIntensity: () => {} },
          wardrobe: nothing,
          closet: nothing,
        });
        const rig = scene.children[0]!;
        // Running first, so the body is turned somewhere of its own before the catch.
        for (let frame = 0; frame < 20; frame += 1) {
          place(local, "Controlled");
          animate(local, { x: 1, y: 0, z: 0 }, true, NO_HOLD);
        }

        // Carried while the carry moves, so the hang tilts the rig. Sampled
        // before each frame's `animate`, the way the frame loop samples input.
        const held: LocalHold = { ...NO_HOLD, role: "held", phase: "limp", pinnedFacing: heldFacing };
        for (let frame = 0; frame < 20; frame += 1) {
          if (frame > 0) expect(local.facing()).toBeCloseTo(heldFacing, 9);
          place(local, "Held", { x: 3, y: 0, z: 1 });
          animate(local, STILL, true, held);
        }
        expect(local.facing()).toBeCloseTo(heldFacing, 9);

        // Let go of, and a few frames on: still facing where it hung, drawn
        // upright at exactly that yaw.
        const upright = new THREE.Quaternion().setFromAxisAngle(UP, modelYawFromFacing(heldFacing));
        for (let frame = 0; frame < 10; frame += 1) {
          place(local, exit === "on its feet" ? "Stagger" : "Ragdoll");
          animate(local, STILL, exit === "on its feet", NO_HOLD);
          expect(local.facing()).toBeCloseTo(heldFacing, 9);
          expect(rig.quaternion.angleTo(upright)).toBeLessThan(1e-6);
        }
        local.dispose();
      },
    );
  });
});
