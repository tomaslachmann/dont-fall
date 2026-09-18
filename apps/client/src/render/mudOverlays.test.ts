import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { MovingSegmentConfig, MudDeck, Vec3 } from "@dont-fall/shared";
import { CAPSULE_BOTTOM_OFFSET, IDENTITY_QUAT, eulerQuat } from "@dont-fall/shared";
import { MUD_SEAT_LIFT } from "@dont-fall/render";
import { buildMudOverlays } from "./mudOverlays.js";

const DECK: MudDeck = {
  segmentIndex: 0,
  deck: { center: { x: 10, y: 2, z: 5 }, yaw: 0, orientation: IDENTITY_QUAT, halfX: 3, halfZ: 4 },
};

/** A carrier turned half round, sliding — its local frame is not the world's. */
const CARRIER: MovingSegmentConfig = {
  segmentIndex: 0,
  moduleId: "bar",
  position: { x: 10, y: 0, z: 5 },
  orientation: { x: 0, y: 1, z: 0, w: 0 },
  scale: 1,
  motion: { slide: { offset: { x: 4, y: 0, z: 0 }, period: 16, easing: "linear" } },
  boxes: [],
  trimeshes: [],
  solids: [],
};

const underCarrier = (object: THREE.Object3D): THREE.Group => {
  const group = new THREE.Group();
  group.position.set(CARRIER.position.x, CARRIER.position.y, CARRIER.position.z);
  group.quaternion.set(CARRIER.orientation.x, CARRIER.orientation.y, CARRIER.orientation.z, CARRIER.orientation.w);
  group.add(object);
  group.updateMatrixWorld(true);
  return group;
};

const bodyOf = (object: THREE.Object3D): THREE.Mesh => object.getObjectByName("mud-body") as THREE.Mesh;

/** Where the body sits lowest below its own rest height, in world space — the dent, if there is one. */
const deepestPress = (object: THREE.Object3D, rest: Float32Array): { depth: number; at: THREE.Vector3 } => {
  const body = bodyOf(object);
  const position = body.geometry.getAttribute("position");
  let depth = 0;
  const at = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    const press = rest[i * 3 + 1]! - position.getY(i);
    if (press > depth) {
      depth = press;
      at.fromBufferAttribute(position, i);
    }
  }
  return { depth, at: body.localToWorld(at) };
};

describe("buildMudOverlays (ADR 0067/0103)", () => {
  it("builds nothing for a Track without mud", () => {
    expect(buildMudOverlays([], [])).toEqual([]);
  });

  it("seats the mass on its deck, tilted with a pitched deck so it stands on the ramp", () => {
    const orientation = eulerQuat(0, -0.25, 0.1);
    const [sheet] = buildMudOverlays([{ segmentIndex: 0, deck: { ...DECK.deck, orientation } }], []);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(orientation.x, orientation.y, orientation.z, orientation.w));

    expect(sheet!.movingIndex).toBeNull();
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(sheet!.object.quaternion).distanceTo(up)).toBeCloseTo(0, 9);
    expect(sheet!.object.position.distanceTo(new THREE.Vector3(10, 2, 5).addScaledVector(up, MUD_SEAT_LIFT))).toBeCloseTo(0, 9);
  });

  it("rides a Moving Segment in its carrier's own frame", () => {
    const [sheet] = buildMudOverlays([DECK], [CARRIER]);
    expect(sheet!.movingIndex).toBe(0);
    underCarrier(sheet!.object);
    const world = sheet!.object.getWorldPosition(new THREE.Vector3());
    expect(world.distanceTo(new THREE.Vector3(10, 2 + MUD_SEAT_LIFT, 5))).toBeCloseTo(0, 9);
  });
});

describe("MudSheet.update (wading)", () => {
  // Feet a metre off the deck's middle, planted on its top (y = 2), read
  // through the capsule centre the stage passes in.
  const standing: Vec3 = { x: 11, y: 2 + CAPSULE_BOTTOM_OFFSET, z: 5 };

  it("sinks under feet standing in it — mapped through a moving carrier to where they really are", () => {
    const [sheet] = buildMudOverlays([DECK], [CARRIER]);
    underCarrier(sheet!.object);
    const rest = Float32Array.from(bodyOf(sheet!.object).geometry.getAttribute("position").array);

    sheet!.update(1, [standing]);
    sheet!.update(1.2, []);
    const press = deepestPress(sheet!.object, rest);
    expect(press.depth).toBeGreaterThan(0.03);
    // Under the feet, not mirrored through the carrier's half turn to x = 9.
    expect(Math.hypot(press.at.x - standing.x, press.at.z - standing.z)).toBeLessThan(0.3);
  });

  it("bubbles on the clock it is given", () => {
    const [sheet] = buildMudOverlays([DECK], []);
    const bubbles = sheet!.object.getObjectByName("mud-bubbles") as THREE.InstancedMesh;
    sheet!.update(1, []);
    const then = Array.from(bubbles.instanceMatrix.array);
    sheet!.update(1.5, []);
    expect(Array.from(bubbles.instanceMatrix.array)).not.toEqual(then);
  });

  it("presses nothing for feet jumping over it, or beside it", () => {
    const [sheet] = buildMudOverlays([DECK], []);
    const scene = new THREE.Scene();
    scene.add(sheet!.object);
    scene.updateMatrixWorld(true);
    const rest = Float32Array.from(bodyOf(sheet!.object).geometry.getAttribute("position").array);

    sheet!.update(1, [{ ...standing, y: standing.y + 1.5 }, { ...standing, x: 100 }]);
    sheet!.update(1.2, []);
    expect(deepestPress(sheet!.object, rest).depth).toBe(0);
  });
});
