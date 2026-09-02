import { addVec3, rotateYaw, type Module, type Track } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import {
  appendModule,
  deleteSegment,
  duplicateSegment,
  insertSegment,
  rechainFrom,
  removeLast,
  rotateSegment,
} from "./trackEdit.js";

const straightModule = (id: string): Module => ({
  id,
  statics: [{ center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 3, y: 0.5, z: 3 } }],
  sockets: [
    { id: "entry", type: "floor", position: { x: 0, y: 0, z: 3 }, yaw: Math.PI },
    { id: "exit", type: "floor", position: { x: 0, y: -0.5, z: -3 }, yaw: 0 },
  ],
  footprint: { bounds: { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 3, y: 1, z: 3 } }, clearance: 0.5 },
});

const MODULES = { start: straightModule("start"), bridge: straightModule("bridge"), gap: straightModule("gap") };

describe("appendModule / insertSegment", () => {
  it("places the first Segment at the origin", () => {
    const track = appendModule([], "start", MODULES);
    expect(track).toEqual([{ moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: 0 }]);
  });

  it("places each following Segment via Socket alignment", () => {
    const track = appendModule(appendModule([], "start", MODULES), "bridge", MODULES);
    expect(track[1]!.position).toEqual({ x: 0, y: -0.5, z: -6 });
  });

  it("inserts in the middle and re-chains everything after it", () => {
    const track = appendModule(appendModule([], "start", MODULES), "bridge", MODULES);
    const inserted = insertSegment(track, MODULES, 1, "gap");

    expect(inserted.map((s) => s.moduleId)).toEqual(["start", "gap", "bridge"]);
    // "bridge" (now at index 2) must have moved one Module-length further out.
    expect(inserted[1]!.position).toEqual({ x: 0, y: -0.5, z: -6 });
    expect(inserted[2]!.position).toEqual({ x: 0, y: -1, z: -12 });
  });

  it("does not mutate the input Track", () => {
    const original: Track = [{ moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: 0 }];
    const appended = appendModule(original, "bridge", MODULES);
    expect(original).toHaveLength(1);
    expect(appended).toHaveLength(2);
  });

  it("throws for an unknown Module id", () => {
    expect(() => appendModule([], "ghost", MODULES)).toThrow(/unknown Module/);
  });
});

describe("deleteSegment", () => {
  it("removes any index (not just the last) and re-chains what follows", () => {
    const track = insertSegment(insertSegment(appendModule([], "start", MODULES), MODULES, 1, "gap"), MODULES, 2, "bridge");
    const withoutGap = deleteSegment(track, MODULES, 1);

    expect(withoutGap.map((s) => s.moduleId)).toEqual(["start", "bridge"]);
    // "bridge" re-chains directly off "start" now that "gap" is gone.
    expect(withoutGap[1]!.position).toEqual({ x: 0, y: -0.5, z: -6 });
  });

  it("deleting the first Segment makes the next one the new anchor, unmoved", () => {
    const track = appendModule(appendModule([], "start", MODULES), "bridge", MODULES);
    const secondPosition = track[1]!.position;
    const result = deleteSegment(track, MODULES, 0);
    expect(result).toEqual([{ moduleId: "bridge", position: secondPosition, rotation: 0 }]);
  });
});

describe("removeLast", () => {
  it("removes the most recently placed Segment", () => {
    const track = appendModule(appendModule([], "start", MODULES), "bridge", MODULES);
    expect(removeLast(track)).toEqual([track[0]]);
  });

  it("is a no-op on an empty Track", () => {
    expect(removeLast([])).toEqual([]);
  });
});

describe("duplicateSegment", () => {
  it("inserts a copy right after the duplicated Segment", () => {
    const track = appendModule(appendModule([], "start", MODULES), "bridge", MODULES);
    const result = duplicateSegment(track, MODULES, 0);

    expect(result.map((s) => s.moduleId)).toEqual(["start", "start", "bridge"]);
    expect(result[1]!.position).toEqual({ x: 0, y: -0.5, z: -6 });
    expect(result[2]!.position).toEqual({ x: 0, y: -1, z: -12 });
  });
});

describe("rotateSegment", () => {
  it("rotates the first Segment in place (no predecessor to anchor against)", () => {
    const track = appendModule([], "start", MODULES);
    const rotated = rotateSegment(track, MODULES, 0, Math.PI / 2);
    expect(rotated[0]!.rotation).toBeCloseTo(Math.PI / 2, 10);
    expect(rotated[0]!.position).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("keeps the rotated Segment's entry Socket anchored to its predecessor's exit Socket", () => {
    const track = appendModule(appendModule([], "start", MODULES), "bridge", MODULES);
    const before = track[1]!;
    const rotated = rotateSegment(track, MODULES, 1, Math.PI / 2);
    const after = rotated[1]!;

    expect(after.rotation).toBeCloseTo(Math.PI / 2, 10);
    // The connection point (entry Socket world position) must be unchanged —
    // only the rotated Segment's own body pivots around it.
    const entryLocal = { x: 0, y: 0, z: 3 };
    const anchorBefore = addVec3(before.position, rotateYaw(entryLocal, before.rotation));
    const anchorAfter = addVec3(after.position, rotateYaw(entryLocal, after.rotation));
    expect(anchorAfter.x).toBeCloseTo(anchorBefore.x, 10);
    expect(anchorAfter.y).toBeCloseTo(anchorBefore.y, 10);
    expect(anchorAfter.z).toBeCloseTo(anchorBefore.z, 10);
  });

  it("re-chains everything after the rotated Segment from its new orientation", () => {
    const track = insertSegment(appendModule(appendModule([], "start", MODULES), "bridge", MODULES), MODULES, 2, "gap");
    const rotated = rotateSegment(track, MODULES, 1, Math.PI / 2);
    // "gap" (index 2) must now continue from "bridge"'s new (rotated) placement.
    expect(rotated[2]!.rotation).toBeCloseTo(Math.PI / 2, 10);
  });
});

describe("rechainFrom", () => {
  it("leaves everything before fromIndex untouched", () => {
    const track = appendModule(appendModule([], "start", MODULES), "bridge", MODULES);
    const result = rechainFrom(track, MODULES, 1);
    expect(result[0]).toEqual(track[0]);
  });

  it("throws for an unknown Module id anywhere in the Track", () => {
    const track: Track = [{ moduleId: "ghost", position: { x: 0, y: 0, z: 0 }, rotation: 0 }];
    expect(() => rechainFrom(track, MODULES, 0)).toThrow(/unknown Module/);
  });
});
