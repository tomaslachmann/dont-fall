import {
  addVec3,
  ATTACHMENT_KEYS,
  conjugateQuat,
  IDENTITY_QUAT,
  orientBox,
  rotateVec3ByQuat,
  placeAfter,
  rotateYaw,
  scaleBox,
  segmentOrientation,
  segmentScale,
  subVec3,
  type AssetCategory,
  type AttachmentKey,
  type Module,
  type Segment,
  type Track,
  type Vec3,
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
  setSegmentAttachment,
  setSegmentTransform,
  setSegmentScale,
  setSegmentTransforms,
  snapDragPosition,
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

/** A socketless piece (every converted asset): dropped by free placement, never chained. */
const socketlessModule = (id: string): Module => ({ ...straightModule(id), sockets: [] });
const MIXED = { start: straightModule("start"), pad: socketlessModule("pad") };

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

describe("building on the last platform (user decision, 2026-09-16)", () => {
  /** A socketless Asset with footprint `bounds` — how every converted piece arrives. */
  const asset = (id: string, center: Vec3, halfExtents: Vec3): Module => ({
    id,
    statics: [],
    sockets: [],
    footprint: { bounds: { center, halfExtents }, clearance: 0.5 },
  });
  // A deck whose top is at y 0, a long deck whose box sits off-centre, a pillar standing on y 0.
  const PIECES = {
    deck: asset("deck", { x: 0, y: -0.25, z: 0 }, { x: 2, y: 0.25, z: 3 }),
    long: asset("long", { x: 1, y: -1, z: -2 }, { x: 2, y: 1, z: 5 }),
    pillar: asset("pillar", { x: 0.5, y: 1, z: 0 }, { x: 0.5, y: 1, z: 0.5 }),
    arch: asset("arch", { x: 0, y: 1.5, z: 0 }, { x: 2, y: 1.5, z: 0.25 }),
  };
  const CATEGORIES: Record<string, AssetCategory> = { deck: "platform", long: "platform", pillar: "obstacle", arch: "gate" };

  /** Where `track[index]`'s footprint box is in the world, turned by its yaw. */
  const worldBox = (track: Track, index: number) => {
    const segment = track[index]!;
    const bounds = scaleBox(PIECES[segment.moduleId as keyof typeof PIECES].footprint.bounds, segmentScale(segment));
    return orientBox(bounds, segment.position, segmentOrientation(segment));
  };
  /** A world point moved into `track[index]`'s turned frame, relative to its footprint box's centre. */
  const inFrameOf = (track: Track, index: number, point: Vec3): Vec3 => {
    const box = worldBox(track, index);
    return rotateVec3ByQuat(subVec3(point, box.center), conjugateQuat(segmentOrientation(track[index]!)));
  };

  const placed = (moduleIds: string[], turn = 0, scale?: number): Track => {
    let track: Track = [{ moduleId: moduleIds[0]!, position: { x: 4, y: 2, z: -1 }, rotation: turn, ...(scale ? { scale } : {}) }];
    for (const id of moduleIds.slice(1)) track = appendModule(track, id, PIECES, CATEGORIES);
    return track;
  };

  it.each([0, Math.PI / 2, -2.3])("puts a new platform flush off the last one's far face, level, turned with it (yaw %s)", (turn) => {
    const track = placed(["deck", "long"], turn);
    const before = worldBox(track, 0);
    const after = worldBox(track, 1);
    // In the first deck's frame: same line, touching faces, tops level.
    const offset = inFrameOf(track, 0, after.center);
    expect(offset.x).toBeCloseTo(0, 9);
    expect(offset.z).toBeCloseTo(-(before.halfExtents.z + after.halfExtents.z), 9);
    expect(after.center.y + after.halfExtents.y).toBeCloseTo(before.center.y + before.halfExtents.y, 9);
    expect(track[1]!.rotation).toBe(turn);
    expect(segmentOverlapsAnyOther(track, PIECES, 1, track[1]!.position, segmentOrientation(track[1]!))).toBe(false);
  });

  it("measures the last platform at its own scale", () => {
    const track = placed(["deck", "deck"], 0, 2);
    const before = worldBox(track, 0);
    const after = worldBox(track, 1);

    expect(after.center.z + after.halfExtents.z).toBeCloseTo(before.center.z - before.halfExtents.z, 9);
    expect(after.center.y + after.halfExtents.y).toBeCloseTo(before.center.y + before.halfExtents.y, 9);
  });

  it.each(["pillar", "arch"])("stands a %s on the middle of the last platform's top, turned with it", (piece) => {
    const turn = 0.8;
    const track = placed(["long", piece], turn);
    const platform = worldBox(track, 0);
    const standing = worldBox(track, 1);

    const offset = inFrameOf(track, 0, standing.center);
    expect(offset.x).toBeCloseTo(0, 9);
    expect(offset.z).toBeCloseTo(0, 9);
    expect(standing.center.y - standing.halfExtents.y).toBeCloseTo(platform.center.y + platform.halfExtents.y, 9);
    expect(track[1]!.rotation).toBe(turn);
  });

  it("builds on the last platform, not on whatever was placed after it", () => {
    const track = placed(["deck", "pillar", "arch", "deck"]);

    // The second deck continues the first; the pillar and the arch both stand on the first.
    expect(worldBox(track, 3).center.z).toBeCloseTo(worldBox(track, 0).center.z - 6, 9);
    expect(worldBox(track, 2).center.x).toBeCloseTo(worldBox(track, 0).center.x, 9);
    expect(worldBox(track, 2).center.z).toBeCloseTo(worldBox(track, 0).center.z, 9);
  });

  it("builds on the last platform before the insert point, when inserting mid-Track", () => {
    const track = placed(["deck", "deck", "deck"]);
    const inserted = insertSegment(track, PIECES, 1, "pillar", CATEGORIES);

    expect(worldBox(inserted, 1).center.z).toBeCloseTo(worldBox(inserted, 0).center.z, 9);
  });

  it("falls back to beside the previous piece with no platform to build on, or without categories", () => {
    const noPlatform = appendModule([{ moduleId: "pillar", position: { x: 0, y: 0, z: 0 }, rotation: 0 }], "pillar", PIECES, CATEGORIES);
    const noCategories = appendModule(placed(["deck"]), "pillar", PIECES);

    for (const track of [noPlatform, noCategories]) {
      expect(track[1]!.position.x).toBeGreaterThan(track[0]!.position.x);
      expect(track[1]!.position.z).toBe(track[0]!.position.z);
      expect(track[1]!.rotation).toBe(0);
    }
  });

  it("still Socket-chains what can be chained", () => {
    // Both socketed platforms: the Sockets decide where the second goes, not the footprints.
    const categories: Record<string, AssetCategory> = { start: "platform", bridge: "platform" };
    const track = appendModule(appendModule([], "start", MODULES, categories), "bridge", MODULES, categories);
    expect(track[1]!.position).toEqual({ x: 0, y: -0.5, z: -6 });
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

describe("setSegmentTransforms (ticket 05 — the multi-select gizmo's rigid-group drag-end commit)", () => {
  const buildTrack = (): Track =>
    insertSegment(
      insertSegment(appendModule(appendModule([], "start", MODULES), "bridge", MODULES), MODULES, 2, "gap"),
      MODULES,
      3,
      "start",
    );

  it("sets every given Segment's absolute transform and flags each manuallyPlaced", () => {
    const track = buildTrack();
    const result = setSegmentTransforms(track, MODULES, [
      { index: 0, transform: { position: { x: 1, y: 0, z: 1 }, rotation: 0.1, pitch: 0, roll: 0 } },
      { index: 2, transform: { position: { x: 5, y: 0, z: 5 }, rotation: 0.2, pitch: 0, roll: 0 } },
    ]);
    expect(result[0]).toMatchObject({ position: { x: 1, y: 0, z: 1 }, rotation: 0.1, manuallyPlaced: true });
    expect(result[2]).toMatchObject({ position: { x: 5, y: 0, z: 5 }, rotation: 0.2, manuallyPlaced: true });
  });

  it("preserves the relative offset between two updated Segments — a rigid-group move", () => {
    const track = buildTrack();
    // Segments 0 and 2 start 12 units apart on X (two auto-chained hops of 6);
    // moving both by the same +100 offset must land them exactly 12 apart still.
    const offsetBy = { x: 100, y: 0, z: 0 };
    const p0 = addVec3(track[0]!.position, offsetBy);
    const p2 = addVec3(track[2]!.position, offsetBy);
    const result = setSegmentTransforms(track, MODULES, [
      { index: 0, transform: { position: p0, rotation: 0, pitch: 0, roll: 0 } },
      { index: 2, transform: { position: p2, rotation: 0, pitch: 0, roll: 0 } },
    ]);
    expect(result[2]!.position.x - result[0]!.position.x).toBeCloseTo(track[2]!.position.x - track[0]!.position.x, 10);
  });

  it("re-chains everything after the last-updated Segment, but a later manually-placed Segment among the updates is left for rechainFrom's usual manuallyPlaced skip", () => {
    const track = buildTrack(); // start(0), bridge(1), gap(2), start(3)
    const result = setSegmentTransforms(track, MODULES, [
      { index: 0, transform: { position: { x: 0, y: 0, z: 0 }, rotation: 0, pitch: 0, roll: 0 } },
      { index: 1, transform: { position: { x: 50, y: 0, z: 0 }, rotation: 0, pitch: 0, roll: 0 } },
    ]);
    // Segment 2 ("gap", never in the update list) must now chain from Segment
    // 1's *new* (x=50) placement, not its original one.
    expect(result[2]!.position.x).toBeCloseTo(50, 10);
  });

  it("an untouched, already manually-placed Segment survives an unrelated later edit exactly as this commit left it", () => {
    const track = buildTrack();
    const committed = setSegmentTransforms(track, MODULES, [
      { index: 0, transform: { position: { x: 1, y: 2, z: 3 }, rotation: 0.4, pitch: 0.1, roll: 0.2 } },
      { index: 3, transform: { position: { x: 9, y: 8, z: 7 }, rotation: 0.6, pitch: 0.3, roll: 0.4 } },
    ]);
    // An unrelated upstream edit elsewhere in the Track re-chains from 0 —
    // both manually-placed Segments must come through byte-for-byte.
    const afterUnrelatedEdit = rechainFrom(committed, MODULES, 0);
    expect(afterUnrelatedEdit[0]).toEqual(committed[0]);
    expect(afterUnrelatedEdit[3]).toEqual(committed[3]);
  });

  it("rejects an out-of-range index among the updates", () => {
    const track = buildTrack();
    expect(() =>
      setSegmentTransforms(track, MODULES, [
        { index: 0, transform: { position: { x: 0, y: 0, z: 0 }, rotation: 0, pitch: 0, roll: 0 } },
        { index: 99, transform: { position: { x: 0, y: 0, z: 0 }, rotation: 0, pitch: 0, roll: 0 } },
      ]),
    ).toThrow(/out of range/);
  });

  it("an empty updates list is a no-op", () => {
    const track = buildTrack();
    expect(setSegmentTransforms(track, MODULES, [])).toEqual(track);
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

describe("Modules without Sockets (every converted asset)", () => {
  // The `pad` carries no Sockets at all: it stands in for a converted asset
  // (the Survival `arena` ADR 0073 deleted served here before), meant to be
  // dropped on its own by free placement (ADR 0034), not chained onto
  // anything. `placeAfter` throws for a missing Socket, so appending one to
  // a Track must take the free-placement path instead of throwing.
  it("can be appended to an existing Track without throwing", () => {
    const track = appendModule([], "start", MIXED);

    expect(() => appendModule(track, "pad", MIXED)).not.toThrow();
  });

  it("can have another Module appended after it", () => {
    const track = appendModule([], "pad", MIXED);

    expect(() => appendModule(track, "start", MIXED)).not.toThrow();
  });

  it("can be duplicated", () => {
    const track = appendModule([], "pad", MIXED);

    expect(() => duplicateSegment(track, MIXED, 0)).not.toThrow();
  });

  it("can be deleted from the middle without breaking the re-chain", () => {
    let track = appendModule([], "start", MIXED);
    track = appendModule(track, "pad", MIXED);
    track = appendModule(track, "start", MIXED);

    expect(() => deleteSegment(track, MIXED, 1)).not.toThrow();
  });

  it("lands beside what it follows, not on top of it", () => {
    const track = appendModule([], "start", MIXED);
    const withPad = appendModule(track, "pad", MIXED);

    // It keeps its own position rather than being chained — free placement is
    // the point — but that position must be somewhere the author can see it.
    // At the world origin it would be buried inside whatever is already there,
    // with only the Segment count to say it arrived.
    expect(withPad[1]!.position).not.toEqual(withPad[0]!.position);
    expect(withPad[1]!.position.x).toBeGreaterThan(
      withPad[0]!.position.x + MIXED.start!.footprint.bounds.halfExtents.x,
    );
    expect(
      segmentOverlapsAnyOther(withPad, MIXED, 1, withPad[1]!.position, segmentOrientation(withPad[1]!)),
    ).toBe(false);
  });

  it("keeps clear of an unchainable predecessor too", () => {
    let track = appendModule([], "start", MIXED);
    track = appendModule(track, "pad", MIXED);
    track = appendModule(track, "start", MIXED);

    // A Module following the pad cannot chain either (the pad has no exit
    // Socket), so it takes the same treatment rather than stacking at origin.
    expect(
      segmentOverlapsAnyOther(track, MIXED, 2, track[2]!.position, segmentOrientation(track[2]!)),
    ).toBe(false);
  });

  // Every converted asset is socketless, so this is how most of a Track gets
  // built now. Each of these used to throw `has no Socket "entry"` for any
  // such Segment past index 0: a gizmo drag moved the mesh on screen but its
  // commit threw, the Track never recorded the move, and the next add or
  // delete rebuilt everything back where it had been.
  const socketlessTrack = (): Track => {
    let track = appendModule([], "start", MIXED);
    track = appendModule(track, "pad", MIXED);
    return appendModule(track, "pad", MIXED);
  };
  const DRAGGED = { position: { x: 40, y: 2, z: -7 }, rotation: 0.5, pitch: 0, roll: 0 };

  it("commits a gizmo drag, and an unrelated add or delete keeps it", () => {
    const dragged = setSegmentTransform(socketlessTrack(), MIXED, 1, DRAGGED);
    expect(dragged[1]!.position).toEqual(DRAGGED.position);

    const added = insertSegment(dragged, MIXED, 3, "pad");
    expect(added[1]!.position).toEqual(DRAGGED.position);
    expect(added[2]!.position).toEqual(dragged[2]!.position);

    const deleted = deleteSegment(added, MIXED, 0);
    expect(deleted[0]!.position).toEqual(DRAGGED.position);
    expect(deleted[1]!.position).toEqual(dragged[2]!.position);
  });

  it("nudges with the keyboard", () => {
    const track = socketlessTrack();
    const moved = moveSegment(track, MIXED, 2, { x: 0.5, y: 0, z: 0 });

    expect(moved[2]!.position).toEqual(addVec3(track[2]!.position, { x: 0.5, y: 0, z: 0 }));
    expect(moved[1]).toEqual(track[1]);
  });

  it("rotates in place about its own origin — there is no entry Socket to pivot on", () => {
    const track = socketlessTrack();
    const rotated = rotateSegment(track, MIXED, 1, Math.PI / 2);

    expect(rotated[1]!.position).toEqual(track[1]!.position);
    expect(rotated[1]!.rotation).toBeCloseTo(Math.PI / 2);
    expect(rotated[2]).toEqual(track[2]);
  });

  it("drags without Socket-snapping, instead of throwing on every drag update", () => {
    const track = socketlessTrack();
    const candidate = { x: 12, y: 0, z: 3 };

    expect(snapPositionToNeighborSocket(track, MIXED, 1, candidate)).toEqual(candidate);
  });

  it("still chains every Module that does have Sockets, exactly as before", () => {
    const chained = appendModule(appendModule([], "start", MODULES), "bridge", MODULES);

    expect(chained[1]!.position).not.toEqual({ x: 0, y: 0, z: 0 });
    expect(chained[1]!.position).toEqual(
      placeAfter(chained[0]!, MODULES.start, "bridge", MODULES.bridge).position,
    );
  });
});

describe("snapDragPosition (gizmo translate: Socket, then faces, then grid)", () => {
  // Socketless, seated on the Asset pivot: 2 × 1 × 2, resting on y = 0.
  const block = (id: string): Module => ({
    id,
    statics: [],
    sockets: [],
    footprint: { bounds: { center: { x: 0, y: 0.5, z: 0 }, halfExtents: { x: 1, y: 0.5, z: 1 } }, clearance: 0.5 },
  });
  const BLOCKS = { a: block("a"), b: block("b") };
  const ALL = { x: true, y: true, z: true };
  const pair = (): Track => [
    { moduleId: "a", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
    { moduleId: "b", position: { x: 10, y: 0, z: 0 }, rotation: 0 },
  ];

  it("stacks onto another Segment's top face, and grids the axes it didn't face-snap", () => {
    expect(snapDragPosition(pair(), BLOCKS, 1, { x: 0.3, y: 1.3, z: 0.2 }, ALL)).toEqual({ x: 0.5, y: 1, z: 0 });
  });

  it("lands flush against a side face", () => {
    expect(snapDragPosition(pair(), BLOCKS, 1, { x: 2.3, y: 0.1, z: 0 }, ALL)).toEqual({ x: 2, y: 0, z: 0 });
  });

  it("tucks under a bottom face", () => {
    const raised: Track = [{ ...pair()[0]!, position: { x: 0, y: 3, z: 0 } }, pair()[1]!];
    expect(snapDragPosition(raised, BLOCKS, 1, { x: 0, y: 1.8, z: 0 }, ALL).y).toBe(2);
  });

  it("only snaps faces it overlaps across the other two axes", () => {
    // Level with the top of `a` but well off to its side: nothing to stand on.
    expect(snapDragPosition(pair(), BLOCKS, 1, { x: 5.2, y: 1.1, z: 0 }, ALL)).toEqual({ x: 5, y: 1, z: 0 });
  });

  it("leaves the axes the dragged handle doesn't move exactly where they were", () => {
    expect(snapDragPosition(pair(), BLOCKS, 1, { x: 0.3, y: 1.3, z: 0.2 }, { x: false, y: true, z: false })).toEqual({
      x: 0.3,
      y: 1,
      z: 0.2,
    });
  });

  it("still Socket-snaps first, exactly as before", () => {
    const track = [
      { moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
      { moduleId: "bridge", position: { x: 0, y: -0.5, z: -6 }, rotation: 0 },
    ];
    const nearSocket = { x: 0.4, y: -0.3, z: -6.2 };

    expect(snapDragPosition(track, MODULES, 1, nearSocket, ALL)).toEqual(
      snapPositionToNeighborSocket(track, MODULES, 1, nearSocket),
    );
    expect(snapDragPosition(track, MODULES, 1, nearSocket, ALL)).not.toEqual(nearSocket);
  });
});

describe("a Segment's Motion through every edit (M11 ticket 06)", () => {
  const SLIDE = { slide: { offset: { x: 0, y: 2, z: 0 }, period: 3, easing: "easeInOut" as const } };
  const chain = (): Track => {
    let track = appendModule([], "start", MODULES);
    track = appendModule(track, "bridge", MODULES);
    return appendModule(track, "gap", MODULES);
  };

  it("sets and clears a Motion without moving anything", () => {
    const track = chain();
    const moving = setSegmentAttachment(track, 1, "motion", SLIDE);

    expect(moving[1]!.motion).toEqual(SLIDE);
    expect(moving.map((s) => s.position)).toEqual(track.map((s) => s.position));
    expect(setSegmentAttachment(moving, 1, "motion", undefined)[1]!.motion).toBeUndefined();
  });

  it("survives its chained Segment being re-placed by an edit upstream", () => {
    const moving = setSegmentAttachment(chain(), 2, "motion", SLIDE);
    const rotated = rotateSegment(moving, MODULES, 1, Math.PI / 2);
    const nudged = moveSegment(moving, MODULES, 0, { x: 1, y: 0, z: 0 });

    expect(rotated[2]!.motion).toEqual(SLIDE);
    expect(nudged[2]!.motion).toEqual(SLIDE);
    expect(deleteSegment(moving, MODULES, 0)[1]!.motion).toEqual(SLIDE);
  });

  it("is copied by Duplicate — a row of identical hammers", () => {
    const moving = setSegmentAttachment(chain(), 1, "motion", SLIDE);

    expect(duplicateSegment(moving, MODULES, 1)[2]!.motion).toEqual(SLIDE);
  });
});

describe("a Segment's Conveyor (ADR 0064)", () => {
  const BELT = { preset: "fast" as const, angle: 1.2 };
  const chain = (): Track => {
    let track = appendModule([], "start", MODULES);
    track = appendModule(track, "bridge", MODULES);
    return appendModule(track, "gap", MODULES);
  };

  it("attaches and detaches a belt without moving anything", () => {
    const track = chain();
    const belted = setSegmentAttachment(track, 1, "conveyor", BELT);

    expect(belted[1]!.conveyor).toEqual(BELT);
    expect(belted.map((s) => s.position)).toEqual(track.map((s) => s.position));
    expect(belted[0]).not.toHaveProperty("conveyor");
    expect(setSegmentAttachment(belted, 1, "conveyor", undefined)[1]).not.toHaveProperty("conveyor");
  });

  it("survives re-chains and is copied by Duplicate, like a Motion", () => {
    const belted = setSegmentAttachment(chain(), 2, "conveyor", BELT);

    expect(rotateSegment(belted, MODULES, 1, Math.PI / 2)[2]!.conveyor).toEqual(BELT);
    expect(duplicateSegment(setSegmentAttachment(chain(), 1, "conveyor", BELT), MODULES, 1)[2]!.conveyor).toEqual(BELT);
  });

  it("throws on an out-of-range index", () => {
    expect(() => setSegmentAttachment(chain(), 9, "conveyor", BELT)).toThrow(/index 9 is out of range/);
  });
});

describe("a Segment's ice (ADR 0066)", () => {
  const chain = (): Track => {
    let track = appendModule([], "start", MODULES);
    track = appendModule(track, "bridge", MODULES);
    return appendModule(track, "gap", MODULES);
  };

  it("attaches and detaches ice without moving anything", () => {
    const track = chain();
    const iced = setSegmentAttachment(track, 1, "ice", true);

    expect(iced[1]!.ice).toBe(true);
    expect(iced.map((s) => s.position)).toEqual(track.map((s) => s.position));
    expect(iced[0]).not.toHaveProperty("ice");
    expect(setSegmentAttachment(iced, 1, "ice", undefined)[1]).not.toHaveProperty("ice");
  });

  it("survives re-chains and is copied by Duplicate, like a belt", () => {
    const iced = setSegmentAttachment(chain(), 2, "ice", true);

    expect(rotateSegment(iced, MODULES, 1, Math.PI / 2)[2]!.ice).toBe(true);
    expect(duplicateSegment(setSegmentAttachment(chain(), 1, "ice", true), MODULES, 1)[2]!.ice).toBe(true);
  });

  it("throws on an out-of-range index", () => {
    expect(() => setSegmentAttachment(chain(), 9, "ice", true)).toThrow(/index 9 is out of range/);
  });
});

describe("a Segment's mud (ADR 0067)", () => {
  const chain = (): Track => {
    let track = appendModule([], "start", MODULES);
    track = appendModule(track, "bridge", MODULES);
    return appendModule(track, "gap", MODULES);
  };

  it("attaches and detaches mud without moving anything", () => {
    const track = chain();
    const muddied = setSegmentAttachment(track, 1, "mud", true);

    expect(muddied[1]!.mud).toBe(true);
    expect(muddied.map((s) => s.position)).toEqual(track.map((s) => s.position));
    expect(muddied[0]).not.toHaveProperty("mud");
    expect(setSegmentAttachment(muddied, 1, "mud", undefined)[1]).not.toHaveProperty("mud");
  });

  it("survives re-chains and is copied by Duplicate, like a belt", () => {
    const muddied = setSegmentAttachment(chain(), 2, "mud", true);

    expect(rotateSegment(muddied, MODULES, 1, Math.PI / 2)[2]!.mud).toBe(true);
    expect(duplicateSegment(setSegmentAttachment(chain(), 1, "mud", true), MODULES, 1)[2]!.mud).toBe(true);
  });

  it("throws on an out-of-range index", () => {
    expect(() => setSegmentAttachment(chain(), 9, "mud", true)).toThrow(/index 9 is out of range/);
  });
});

describe("every Attachment through a re-chain and a Duplicate (ADR 0099)", () => {
  // Over every Attachment, so a new one does not compile until it is sampled here.
  const SAMPLES: { [K in AttachmentKey]-?: NonNullable<Segment[K]> } = {
    motion: { slide: { offset: { x: 0, y: 2, z: 0 }, period: 3, easing: "easeInOut" } },
    conveyor: { preset: "fast", angle: 1.2 },
    ice: true,
    mud: true,
    bounce: true,
    launch: { height: 6 },
    prop: true,
    start: true,
    checkpoint: { order: 1 },
  };
  const carrying = (key: AttachmentKey): Track => {
    let track = appendModule([], "start", MODULES);
    track = appendModule(track, "bridge", MODULES);
    track = appendModule(track, "gap", MODULES);
    return track.map((segment, i) => (i === 2 ? { ...segment, [key]: SAMPLES[key] } : segment));
  };

  // bounce, launch and prop were each dropped by the first of these until the
  // re-chain read the registry instead of its own list.
  it.each(ATTACHMENT_KEYS)("keeps %s when its chained Segment is re-placed", (key) => {
    const track = carrying(key);
    expect(rotateSegment(track, MODULES, 1, Math.PI / 2)[2]![key], "rotated upstream").toEqual(SAMPLES[key]);
    expect(moveSegment(track, MODULES, 0, { x: 1, y: 0, z: 0 })[2]![key], "moved upstream").toEqual(SAMPLES[key]);
    expect(setSegmentScale(track, MODULES, 2, 2)[2]![key], "scaled").toEqual(SAMPLES[key]);
    expect(moveSegment(track, MODULES, 2, { x: 1, y: 0, z: 0 })[2]![key], "moved").toEqual(SAMPLES[key]);
  });

  it.each(ATTACHMENT_KEYS.filter((key) => key !== "start" && key !== "checkpoint"))("copies %s with Duplicate", (key) => {
    expect(duplicateSegment(carrying(key), MODULES, 2)[3]![key]).toEqual(SAMPLES[key]);
  });
});

describe("scaling a Segment (ADR 0062)", () => {
  const chain = (): Track => {
    let track = appendModule([], "start", MODULES);
    track = appendModule(track, "bridge", MODULES);
    return appendModule(track, "gap", MODULES);
  };

  it("keeps a chained Segment attached at its entry and re-chains what follows", () => {
    const track = chain();
    const scaled = setSegmentScale(track, MODULES, 1, 2);

    expect(scaled[1]!.scale).toBe(2);
    // Still flush against its predecessor: re-placed through the scaled entry Socket.
    expect(scaled[1]).toEqual(placeAfter(scaled[0]!, MODULES.start, "bridge", MODULES.bridge, "exit", "entry", 2));
    // The next one now meets the scaled exit.
    expect(scaled[2]!.position).toEqual(placeAfter(scaled[1]!, MODULES.bridge, "gap", MODULES.gap).position);
    expect(scaled[2]!.position).not.toEqual(track[2]!.position);
  });

  it("clamps to the stored bounds and forgets a scale of exactly 1", () => {
    const track = chain();
    expect(setSegmentScale(track, MODULES, 1, 100)[1]!.scale).toBe(4);
    expect(setSegmentScale(track, MODULES, 1, 0.01)[1]!.scale).toBe(0.25);
    expect(setSegmentScale(setSegmentScale(track, MODULES, 1, 2), MODULES, 1, 1)[1]).not.toHaveProperty("scale");
  });

  it("grows a free-placed Segment about its own origin, where it stands", () => {
    const track = setSegmentTransform(chain(), MODULES, 1, { position: { x: 20, y: 0, z: 0 }, rotation: 0, pitch: 0, roll: 0 });
    expect(setSegmentScale(track, MODULES, 1, 3)[1]!.position).toEqual({ x: 20, y: 0, z: 0 });
  });

  it("keeps its scale through a gizmo drag that doesn't touch it, and through Duplicate", () => {
    const scaled = setSegmentScale(chain(), MODULES, 1, 2);
    expect(setSegmentTransform(scaled, MODULES, 1, { position: { x: 3, y: 0, z: 0 }, rotation: 0, pitch: 0, roll: 0 })[1]!.scale).toBe(2);
    expect(duplicateSegment(scaled, MODULES, 1)[2]!.scale).toBe(2);
  });

  it("measures overlap and Socket-snap with the scaled Footprint and Sockets", () => {
    const track: Track = [
      { moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
      { moduleId: "bridge", position: { x: 0, y: 0, z: -20 }, rotation: 0 },
      { moduleId: "gap", position: { x: 9, y: 0, z: 0 }, rotation: 0, scale: 2 },
    ];
    // 1×, the gap's Footprint (half 3, clearance 0.5) would clear the start at x = 9; at 2× (half 6) it reaches it.
    expect(segmentOverlapsAnyOther(track, MODULES, 2, { x: 9, y: 0, z: 0 }, IDENTITY_QUAT)).toBe(true);
    const { scale: _scale, ...unscaled } = track[2]!;
    expect(segmentOverlapsAnyOther([...track.slice(0, 2), unscaled], MODULES, 2, { x: 9, y: 0, z: 0 }, IDENTITY_QUAT)).toBe(false);
  });
});
