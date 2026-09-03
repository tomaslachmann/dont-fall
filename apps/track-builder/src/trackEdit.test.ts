import {
  addVec3,
  IDENTITY_QUAT,
  rotateVec3ByQuat,
  rotateYaw,
  segmentOrientation,
  type Module,
  type Track,
} from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import {
  appendModule,
  deleteSegment,
  duplicateSegment,
  insertSegment,
  moveSegment,
  rechainFrom,
  removeLast,
  rotateSegment,
  segmentOverlapsAnyOther,
  setSegmentTransform,
  snapPositionToNeighborSocket,
  SOCKET_SNAP_RADIUS,
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

  it("preserves a non-first Segment's pitch/roll inherited from a tilted predecessor — this rotate is yaw-only and must not drop them (code review)", () => {
    // Segment 1's own pitch/roll come from `rechainFrom`/`placeAfter`
    // propagating Segment 0's tilt through the socket chain (ADR 0034) — not
    // independently authored (there's no free-standing tilt UI yet). The bug
    // was building a fresh `{ moduleId, position, rotation }` literal instead
    // of spreading `segment`, silently dropping that propagated tilt.
    const track = appendModule(appendModule([], "start", MODULES), "bridge", MODULES);
    track[0] = { ...track[0]!, pitch: 0.3, roll: 0.2 };
    const settled = rechainFrom(track, MODULES, 1);
    expect(settled[1]!.pitch).not.toBe(0); // sanity: the predecessor's tilt really does propagate

    const rotated = rotateSegment(track, MODULES, 1, Math.PI / 2);
    expect(rotated[1]!.pitch).toBeCloseTo(settled[1]!.pitch!, 10);
    expect(rotated[1]!.roll).toBeCloseTo(settled[1]!.roll!, 10);
  });

  it("marks the rotated Segment manuallyPlaced (ticket 02)", () => {
    const track = appendModule(appendModule([], "start", MODULES), "bridge", MODULES);
    const rotated = rotateSegment(track, MODULES, 1, Math.PI / 2);
    expect(rotated[1]!.manuallyPlaced).toBe(true);
  });

  it("rotates on the pitch axis when asked, still pivoting around the entry Socket", () => {
    const track = appendModule(appendModule([], "start", MODULES), "bridge", MODULES);
    const before = track[1]!;
    const rotated = rotateSegment(track, MODULES, 1, 0.3, "pitch");
    const after = rotated[1]!;

    expect(after.pitch).toBeCloseTo(0.3, 10);
    expect(after.rotation).toBeCloseTo(before.rotation, 10); // yaw untouched

    const entryLocal = { x: 0, y: 0, z: 3 };
    const anchorBefore = addVec3(before.position, rotateVec3ByQuat(entryLocal, segmentOrientation(before)));
    const anchorAfter = addVec3(after.position, rotateVec3ByQuat(entryLocal, segmentOrientation(after)));
    expect(anchorAfter.x).toBeCloseTo(anchorBefore.x, 10);
    expect(anchorAfter.y).toBeCloseTo(anchorBefore.y, 10);
    expect(anchorAfter.z).toBeCloseTo(anchorBefore.z, 10);
  });

  it("rotates on the roll axis when asked, additively on top of any existing roll", () => {
    const track = appendModule([], "start", MODULES);
    track[0] = { ...track[0]!, roll: 0.1 };
    const rotated = rotateSegment(track, MODULES, 0, 0.2, "roll");
    expect(rotated[0]!.roll).toBeCloseTo(0.3, 10);
  });

  it("normalizes an accumulated angle into [0, 2π) instead of growing unbounded", () => {
    const track = appendModule([], "start", MODULES);
    let result = track;
    for (let i = 0; i < 30; i += 1) result = rotateSegment(result, MODULES, 0, Math.PI / 6); // 30 x 30° = 900°
    expect(result[0]!.rotation).toBeGreaterThanOrEqual(0);
    expect(result[0]!.rotation).toBeLessThan(2 * Math.PI);
  });
});

describe("moveSegment (ticket 02)", () => {
  it("offsets the Segment's world position by the given delta", () => {
    const track = appendModule(appendModule([], "start", MODULES), "bridge", MODULES);
    const before = track[1]!.position;
    const moved = moveSegment(track, MODULES, 1, { x: 1, y: 0.5, z: -2 });
    expect(moved[1]!.position).toEqual({ x: before.x + 1, y: before.y + 0.5, z: before.z - 2 });
  });

  it("marks the moved Segment manuallyPlaced", () => {
    const track = appendModule([], "start", MODULES);
    const moved = moveSegment(track, MODULES, 0, { x: 1, y: 0, z: 0 });
    expect(moved[0]!.manuallyPlaced).toBe(true);
  });

  it("re-chains everything after the moved Segment from its new position", () => {
    const track = insertSegment(appendModule(appendModule([], "start", MODULES), "bridge", MODULES), MODULES, 2, "gap");
    const moved = moveSegment(track, MODULES, 1, { x: 5, y: 0, z: 0 });
    // "gap" (index 2) must now continue from "bridge"'s new (moved) placement.
    expect(moved[2]!.position.x).toBeCloseTo(moved[1]!.position.x, 10);
  });

  it("rejects an out-of-range index", () => {
    const track = appendModule([], "start", MODULES);
    expect(() => moveSegment(track, MODULES, 5, { x: 0, y: 0, z: 0 })).toThrow(/out of range/);
  });
});

describe("rechainFrom + manuallyPlaced (ticket 02)", () => {
  it("preserves pitch/roll/manuallyPlaced on the first Segment (code review-style gap: used to build a bare {moduleId,position,rotation} literal)", () => {
    const track: Track = [{ moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: 0, pitch: 0.2, roll: 0.1, manuallyPlaced: true }];
    const result = rechainFrom(track, MODULES, 0);
    expect(result[0]).toEqual(track[0]);
  });

  it("does not overwrite a manuallyPlaced Segment when cascading from an earlier edit", () => {
    const track = appendModule(appendModule([], "start", MODULES), "bridge", MODULES);
    const manual = moveSegment(track, MODULES, 1, { x: 10, y: 3, z: -7 });
    // Simulate an unrelated edit earlier in the sequence by re-chaining from
    // index 0 — the manually-placed Segment 1 must come through untouched.
    const result = rechainFrom(manual, MODULES, 0);
    expect(result[1]).toEqual(manual[1]);
  });

  it("a Segment after a manually-placed one still chains from the manually-placed Segment's actual position", () => {
    const track = insertSegment(appendModule(appendModule([], "start", MODULES), "bridge", MODULES), MODULES, 2, "gap");
    const manual = moveSegment(track, MODULES, 1, { x: 10, y: 0, z: 0 });
    const result = rechainFrom(manual, MODULES, 0);
    // "gap" (index 2, never touched) must follow "bridge"'s moved position, not its original one.
    expect(result[2]!.position.x).toBeCloseTo(manual[1]!.position.x, 10);
  });
});

describe("index bounds validation (code review, ticket 08)", () => {
  const track = appendModule(appendModule([], "start", MODULES), "bridge", MODULES);

  it("deleteSegment rejects an out-of-range index", () => {
    expect(() => deleteSegment(track, MODULES, 5)).toThrow(/out of range/);
    expect(() => deleteSegment(track, MODULES, -1)).toThrow(/out of range/);
  });

  it("duplicateSegment rejects an out-of-range index", () => {
    expect(() => duplicateSegment(track, MODULES, 5)).toThrow(/out of range/);
  });

  it("rotateSegment rejects an out-of-range index", () => {
    expect(() => rotateSegment(track, MODULES, 5, Math.PI / 2)).toThrow(/out of range/);
  });

  it("insertSegment rejects an out-of-range index but allows inserting at track.length", () => {
    expect(() => insertSegment(track, MODULES, 5, "start")).toThrow(/out of range/);
    expect(() => insertSegment(track, MODULES, track.length, "start")).not.toThrow();
  });

  it("rotateSegment accepts a delta that isn't a multiple of 90° (ADR 0034 lifted that restriction)", () => {
    expect(() => rotateSegment(track, MODULES, 0, Math.PI / 4)).not.toThrow();
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

describe("setSegmentTransform (ticket 03 — the on-canvas gizmo commits an absolute transform, not a delta)", () => {
  it("sets the Segment's position/rotation/pitch/roll wholesale", () => {
    const track = appendModule(appendModule([], "start", MODULES), "bridge", MODULES);
    const result = setSegmentTransform(track, MODULES, 1, {
      position: { x: 10, y: 2, z: -3 },
      rotation: 0.5,
      pitch: 0.1,
      roll: 0.2,
    });
    expect(result[1]).toMatchObject({
      position: { x: 10, y: 2, z: -3 },
      rotation: 0.5,
      pitch: 0.1,
      roll: 0.2,
      manuallyPlaced: true,
    });
  });

  it("re-chains everything after the Segment from its new transform", () => {
    const track = insertSegment(appendModule(appendModule([], "start", MODULES), "bridge", MODULES), MODULES, 2, "gap");
    const result = setSegmentTransform(track, MODULES, 1, { position: { x: 20, y: 0, z: 0 }, rotation: 0, pitch: 0, roll: 0 });
    // "gap" (index 2) must now continue from "bridge"'s new placement.
    expect(result[2]!.position.x).toBeCloseTo(20, 10);
  });

  it("rejects an out-of-range index", () => {
    const track = appendModule([], "start", MODULES);
    expect(() =>
      setSegmentTransform(track, MODULES, 5, { position: { x: 0, y: 0, z: 0 }, rotation: 0, pitch: 0, roll: 0 }),
    ).toThrow(/out of range/);
  });
});

describe("snapPositionToNeighborSocket (ticket 03 — translate-drag Socket snap, scoped to the linear chain's own two neighbors per ADR 0034/0030)", () => {
  it("leaves an already-aligned position unchanged (distance 0 is within radius)", () => {
    const track = appendModule(appendModule([], "start", MODULES), "bridge", MODULES);
    const aligned = track[1]!.position;
    const snapped = snapPositionToNeighborSocket(track, MODULES, 1, aligned);
    expect(snapped.x).toBeCloseTo(aligned.x, 10);
    expect(snapped.y).toBeCloseTo(aligned.y, 10);
    expect(snapped.z).toBeCloseTo(aligned.z, 10);
  });

  it("snaps a nearby candidate position back into exact alignment with the predecessor's exit Socket", () => {
    const track = appendModule(appendModule([], "start", MODULES), "bridge", MODULES);
    const aligned = track[1]!.position;
    const nudged = { x: aligned.x + 0.3, y: aligned.y, z: aligned.z - 0.2 };
    const snapped = snapPositionToNeighborSocket(track, MODULES, 1, nudged);
    expect(snapped.x).toBeCloseTo(aligned.x, 10);
    expect(snapped.z).toBeCloseTo(aligned.z, 10);
  });

  it("does not snap a candidate position beyond the snap radius", () => {
    const track = appendModule(appendModule([], "start", MODULES), "bridge", MODULES);
    const aligned = track[1]!.position;
    const farAway = { x: aligned.x + SOCKET_SNAP_RADIUS * 3, y: aligned.y, z: aligned.z };
    const snapped = snapPositionToNeighborSocket(track, MODULES, 1, farAway);
    expect(snapped).toEqual(farAway);
  });

  it("snaps toward the successor's entry Socket when dragging a Segment with no predecessor", () => {
    const track = appendModule(appendModule([], "start", MODULES), "bridge", MODULES);
    const aligned = track[0]!.position; // "start" has no predecessor, only a successor ("bridge")
    const nudged = { x: aligned.x + 0.2, y: aligned.y, z: aligned.z + 0.1 };
    const snapped = snapPositionToNeighborSocket(track, MODULES, 0, nudged);
    expect(snapped.x).toBeCloseTo(aligned.x, 10);
    expect(snapped.z).toBeCloseTo(aligned.z, 10);
  });

  it("returns the candidate position unchanged when there is no neighbor at all", () => {
    const track = appendModule([], "start", MODULES);
    const candidate = { x: 5, y: 1, z: 5 };
    expect(snapPositionToNeighborSocket(track, MODULES, 0, candidate)).toEqual(candidate);
  });

  it("never touches rotation — Socket-snap and rotate-snap are independent concerns (ticket 03)", () => {
    const track = appendModule(appendModule([], "start", MODULES), "bridge", MODULES);
    const aligned = track[1]!.position;
    const nudged = { x: aligned.x + 0.3, y: aligned.y, z: aligned.z };
    const snapped = snapPositionToNeighborSocket(track, MODULES, 1, nudged);
    // Returns a Vec3, not a Segment — nothing to assert about rotation here,
    // but confirms the function's contract stays position-only.
    expect(Object.keys(snapped).sort()).toEqual(["x", "y", "z"]);
  });
});

describe("segmentOverlapsAnyOther (ticket 04 — live overlap-feedback primitive)", () => {
  // Three auto-chained Segments: "start" (z=0), "bridge" (z=-6), "gap" (z=-12)
  // — each footprint spans 6 units in Z (halfExtents.z=3), so adjacent
  // Segments' footprints touch exactly at their shared Socket boundary.
  const track = appendModule(appendModule(appendModule([], "start", MODULES), "bridge", MODULES), "gap", MODULES);

  it("does not flag a Segment against its own immediate chain neighbors, even though their footprints touch exactly at the shared Socket", () => {
    // Segment 1 ("bridge") touches both its neighbors by construction — that
    // is the *normal*, intended connection, not a placement mistake, so it
    // must never register as overlap (same "the Track's own two natural
    // connection points are special" reasoning as ticket 03's Socket-snap).
    const overlaps = segmentOverlapsAnyOther(track, MODULES, 1, track[1]!.position, IDENTITY_QUAT);
    expect(overlaps).toBe(false);
  });

  it("flags overlap against a non-adjacent Segment", () => {
    // Drag Segment 2 ("gap") onto exactly where Segment 0 ("start") sits —
    // two steps away in the chain, not an immediate neighbor.
    const overlaps = segmentOverlapsAnyOther(track, MODULES, 2, track[0]!.position, IDENTITY_QUAT);
    expect(overlaps).toBe(true);
  });

  it("does not flag overlap when clearly separated from every non-adjacent Segment", () => {
    const farAway = { x: 1000, y: 0, z: 1000 };
    const overlaps = segmentOverlapsAnyOther(track, MODULES, 2, farAway, IDENTITY_QUAT);
    expect(overlaps).toBe(false);
  });

  it("accounts for Footprint clearance — a small gap smaller than the combined clearance still flags overlap", () => {
    // Segment 0's footprint spans world Z [-3, 3]. Each Module's clearance is
    // 0.5, so two Footprints need at least a 1-unit gap to clear each other.
    // Placing Segment 2's footprint 0.3 units short of Segment 0's edge
    // leaves only a 0.3-unit real gap — inside the combined 1-unit clearance.
    const closeGapCenter = { x: track[0]!.position.x, y: track[0]!.position.y, z: track[0]!.position.z + 3 + 0.3 + 3 };
    expect(segmentOverlapsAnyOther(track, MODULES, 2, closeGapCenter, IDENTITY_QUAT)).toBe(true);
  });

  it("does not flag overlap once the gap exceeds the combined clearance", () => {
    const clearGapCenter = { x: track[0]!.position.x, y: track[0]!.position.y, z: track[0]!.position.z + 3 + 1.2 + 3 };
    expect(segmentOverlapsAnyOther(track, MODULES, 2, clearGapCenter, IDENTITY_QUAT)).toBe(false);
  });

  it("returns false for an out-of-range index instead of throwing — a live drag callback shouldn't crash the frame loop", () => {
    expect(segmentOverlapsAnyOther(track, MODULES, 99, { x: 0, y: 0, z: 0 }, IDENTITY_QUAT)).toBe(false);
  });
});
