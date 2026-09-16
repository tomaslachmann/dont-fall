import {
  applyMotionPose,
  axisAngleQuat,
  IDENTITY_QUAT,
  movingSegmentPose,
  type MovingSegmentConfig,
  type SegmentMotion,
  type Vec3,
} from "@dont-fall/shared";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { localBounds, lowestDrawnY, lowestMovingY } from "./lowestDrawnY.js";

type Placement = Pick<MovingSegmentConfig, "position" | "orientation" | "scale" | "motion">;

const box = (size: Vec3, centre: Vec3 = { x: 0, y: 0, z: 0 }): THREE.Mesh => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z));
  mesh.position.set(centre.x, centre.y, centre.z);
  return mesh;
};

/** A drawn Segment group the way the Stage builds one: geometry in the local, already-scaled frame. */
const segmentVisual = (...parts: THREE.Object3D[]): THREE.Group => {
  const group = new THREE.Group();
  group.add(...parts);
  return group;
};

/**
 * The lowest Y the visual's bounding-box corners actually reach over many
 * ticks of the real pose function — what the bound must never be above.
 */
const sampledLowest = (visual: THREE.Group, placement: Placement, ticks = 4000): number => {
  const local = new THREE.Box3().setFromObject(visual);
  const localCorners: Vec3[] = [];
  for (const x of [local.min.x, local.max.x])
    for (const y of [local.min.y, local.max.y])
      for (const z of [local.min.z, local.max.z]) localCorners.push({ x, y, z });
  let lowest = Infinity;
  for (let tick = 0; tick < ticks; tick += 1) {
    const pose = movingSegmentPose(placement, tick);
    for (const corner of localCorners) lowest = Math.min(lowest, applyMotionPose(pose, corner).y);
  }
  return lowest;
};

const still = (motion: SegmentMotion, overrides: Partial<Placement> = {}): Placement => ({
  position: { x: 3, y: 1, z: -4 },
  orientation: IDENTITY_QUAT,
  scale: 1,
  motion,
  ...overrides,
});

describe("lowestDrawnY", () => {
  it("is the lowest point any object draws, in world space", () => {
    const deck = box({ x: 4, y: 1, z: 4 }, { x: 0, y: 2, z: 0 });
    const parent = new THREE.Group();
    parent.position.y = -3;
    parent.add(box({ x: 1, y: 2, z: 1 }, { x: 5, y: 0, z: 0 }));

    expect(lowestDrawnY([deck, parent])).toBeCloseTo(-4, 10);
  });

  it("is Infinity when nothing is drawn", () => {
    expect(lowestDrawnY([])).toBe(Infinity);
    expect(lowestDrawnY([new THREE.Group()])).toBe(Infinity);
  });
});

describe("localBounds", () => {
  it("is the geometry in the root's own frame, whatever the root is posed at", () => {
    const resting = segmentVisual(box({ x: 2, y: 1, z: 4 }, { x: 1, y: 0, z: 0 }));
    const posed = segmentVisual(box({ x: 2, y: 1, z: 4 }, { x: 1, y: 0, z: 0 }));
    posed.position.set(40, -20, 7);
    posed.quaternion.set(0.3, 0.1, 0, 0.95).normalize();
    posed.scale.setScalar(3);

    const expected = new THREE.Box3(new THREE.Vector3(0, -0.5, -2), new THREE.Vector3(2, 0.5, 2));
    for (const root of [resting, posed]) {
      const bounds = localBounds(root);
      expect(bounds.min.distanceTo(expected.min)).toBeLessThan(1e-9);
      expect(bounds.max.distanceTo(expected.max)).toBeLessThan(1e-9);
    }
  });
});

describe("lowestMovingY", () => {
  const plank = (): THREE.Group => segmentVisual(box({ x: 6, y: 0.5, z: 2 }));

  it("is the rest pose's lowest point for a piece with nothing that turns or slides down", () => {
    const placement = still({ slide: { offset: { x: 0, y: 3, z: 0 }, period: 2, easing: "linear", pause: 0.5 } });
    expect(lowestMovingY(localBounds(plank()), placement)).toBeCloseTo(1 - 0.25, 10);
  });

  it("adds a downward slide's whole offset, through the Segment's orientation and scale", () => {
    const placement = still(
      { slide: { offset: { x: 2, y: 0, z: 0 }, period: 2, easing: "easeInOut", pause: 0.5 } },
      // Turned so local +X points down, at double size.
      { orientation: axisAngleQuat({ x: 0, y: 0, z: 1 }, -Math.PI / 2), scale: 2 },
    );
    const visual = plank();
    const bound = lowestMovingY(localBounds(visual), placement);

    expect(bound).toBeCloseTo(sampledLowest(visual, placement), 6);
  });

  it("never sits above what a spinning piece reaches", () => {
    const visual = segmentVisual(box({ x: 8, y: 0.4, z: 0.4 }, { x: 2, y: 0, z: 0 }));
    const placement = still({ spin: { axis: { x: 0, y: 0, z: 1 }, pivot: { x: 0, y: 0, z: 0 }, speed: 1.3 } });

    const bound = lowestMovingY(localBounds(visual), placement);
    expect(bound).toBeLessThanOrEqual(sampledLowest(visual, placement) + 1e-9);
    // …and not wildly below it: the arm reaches 6 units down from the pivot at y 1.
    expect(bound).toBeGreaterThan(1 - 6.1);
  });

  it("never sits above what a swinging, spinning and sliding piece reaches", () => {
    const visual = segmentVisual(box({ x: 3, y: 1, z: 1 }, { x: 0, y: -2, z: 0 }), box({ x: 1, y: 1, z: 1 }, { x: 1, y: 0, z: 1 }));
    const placement = still(
      {
        spin: { axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0.5, y: 0, z: 0 }, speed: 2 },
        swing: { axis: { x: 1, y: 0, z: 0 }, pivot: { x: 0, y: 1, z: 0 }, amplitude: 1.2, period: 1.7, easing: "easeInOut" },
        slide: { offset: { x: 0, y: -1.5, z: 1 }, period: 3.1, easing: "linear", pause: 0.2 },
      },
      { orientation: axisAngleQuat({ x: 1, y: 1, z: 0 }, 0.7), scale: 1.5 },
    );

    expect(lowestMovingY(localBounds(visual), placement)).toBeLessThanOrEqual(sampledLowest(visual, placement) + 1e-9);
  });

  it("is Infinity for a piece that draws nothing", () => {
    expect(lowestMovingY(localBounds(new THREE.Group()), still({}))).toBe(Infinity);
  });
});
