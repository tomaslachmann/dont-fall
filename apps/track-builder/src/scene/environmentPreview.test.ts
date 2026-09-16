import type { Module, Segment, Track } from "@dont-fall/shared";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { lowestSegmentY } from "./environmentPreview.js";
import { applyMotionAt, buildSegmentGroup } from "./render.js";

/** A synthetic 8×1×8 deck and its visual — the drawn extent is what's under test, not an Asset's art. */
const DECK: Module = {
  id: "deck",
  statics: [],
  sockets: [],
  footprint: { bounds: { center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 4, y: 0.5, z: 4 } }, clearance: 0.5 },
};
const deckTemplate = (): THREE.Group => {
  const template = new THREE.Group();
  const board = new THREE.Mesh(new THREE.BoxGeometry(8, 1, 8), new THREE.MeshBasicMaterial());
  board.position.y = -0.5;
  template.add(board);
  return template;
};

const groupsOf = (track: Track, tick = 0): THREE.Object3D[] =>
  track.map((segment, index) => {
    const group = buildSegmentGroup({ deck: DECK }, segment, { deck: deckTemplate() })!;
    group.userData.segmentIndex = index;
    applyMotionAt(group, segment, tick);
    return group;
  });

const at = (y: number, extra: Partial<Segment> = {}): Segment => ({ moduleId: "deck", position: { x: 0, y, z: 0 }, rotation: 0, ...extra });

describe("lowestSegmentY", () => {
  it("is Infinity for an empty Track", () => {
    expect(lowestSegmentY([], [])).toBe(Infinity);
  });

  it("is the lowest point a still Segment draws", () => {
    const track = [at(4), at(-2)];
    const expected = new THREE.Box3().setFromObject(groupsOf([at(-2)])[0]!).min.y;

    expect(lowestSegmentY(groupsOf(track), track)).toBeCloseTo(expected, 10);
  });

  it("reaches as low as a Slide carries a Segment, at its scale, wherever the preview clock has it", () => {
    const slide = { offset: { x: 0, y: -3, z: 0 }, period: 2, easing: "linear" as const, pause: 0.5 };
    const still = [at(0, { scale: 2 })];
    const sliding = [at(0, { scale: 2, motion: { slide } })];
    const restLowest = lowestSegmentY(groupsOf(still), still);

    for (const tick of [0, 17, 45]) {
      expect(lowestSegmentY(groupsOf(sliding, tick), sliding)).toBeCloseTo(restLowest - 6, 6);
    }
  });
});
