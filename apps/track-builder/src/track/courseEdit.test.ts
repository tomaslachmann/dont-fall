import { addVec3, ASSET_PLACEMENT_MODULES, rotateVec3ByQuat, scaleVec3, segmentOrientation, type Track } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { courseOf, motionLockReason } from "../lib/course.js";
import {
  compactCheckpoints,
  deleteSegment,
  duplicateSegment,
  nextCheckpointOrder,
  rechainFrom,
  setCheckpointRespawn,
  setSegmentCheckpoint,
  setSegmentStart,
  stepCheckpointOrder,
  worldToSegmentLocal,
} from "./trackEdit.js";

const LIBRARY = ASSET_PLACEMENT_MODULES;
const arch = (x: number) => ({ moduleId: "kaykit_arch_blue", position: { x, y: 0, z: 0 }, rotation: 0 });
const floor = (x: number) => ({ moduleId: "kaykit_floor_wood_2x2", position: { x, y: 0, z: 0 }, rotation: 0 });
const orders = (track: Track) => track.map((segment) => segment.checkpoint?.order ?? null);

describe("the Start (ADR 0068)", () => {
  it("moves to whichever Segment is made the Start — a Track has one", () => {
    let track: Track = [floor(0), floor(4), arch(8)];
    track = setSegmentStart(track, 0, true);
    track = setSegmentStart(track, 1, true);
    expect(track.map((s) => s.start ?? false)).toEqual([false, true, false]);
    expect(track[0]).not.toHaveProperty("start");
    track = setSegmentStart(track, 1, false);
    expect(track.some((s) => "start" in s)).toBe(false);
  });

  it("is never copied by Duplicate", () => {
    const track = duplicateSegment(setSegmentStart([floor(0)], 0, true), LIBRARY, 0);
    expect(track.map((s) => s.start ?? false)).toEqual([true, false]);
  });
});

describe("numbered Checkpoints (ADR 0068)", () => {
  it("numbers each switched-on gate next, and closes the gap when one is switched off or deleted", () => {
    let track: Track = [arch(0), floor(4), arch(8), arch(12)];
    track = setSegmentCheckpoint(track, 3, true);
    track = setSegmentCheckpoint(track, 0, true);
    track = setSegmentCheckpoint(track, 2, true);
    expect(orders(track)).toEqual([2, null, 3, 1]);
    expect(nextCheckpointOrder(track)).toBe(4);

    expect(orders(setSegmentCheckpoint(track, 0, false))).toEqual([null, null, 2, 1]);
    expect(orders(deleteSegment(track, LIBRARY, 3))).toEqual([1, null, 2]);
  });

  it("swaps numbers with its neighbour, and does nothing past either end", () => {
    const track = [1, 2, 3].map((order, i) => ({ ...arch(i * 4), checkpoint: { order } }));
    expect(orders(stepCheckpointOrder(track, 1, 1))).toEqual([1, 3, 2]);
    expect(orders(stepCheckpointOrder(track, 1, -1))).toEqual([2, 1, 3]);
    expect(stepCheckpointOrder(track, 0, -1)).toBe(track);
    expect(stepCheckpointOrder(track, 2, 1)).toBe(track);
  });

  it("duplicates a Checkpoint as the next one, respawn spot included", () => {
    const track = duplicateSegment([{ ...arch(0), checkpoint: { order: 1, respawn: { x: 0, y: 0, z: 2 } } }], LIBRARY, 0);
    expect(track[1]!.checkpoint).toEqual({ order: 2, respawn: { x: 0, y: 0, z: 2 } });
  });

  it("compacts a stored gap without disturbing the order", () => {
    const track = [5, 2, 9].map((order, i) => ({ ...arch(i * 4), checkpoint: { order } }));
    expect(orders(compactCheckpoints(track))).toEqual([2, 1, 3]);
  });

  it("sets and clears the respawn spot, only on a Checkpoint", () => {
    const track: Track = [{ ...arch(0), checkpoint: { order: 1 } }, floor(4)];
    const picked = setCheckpointRespawn(track, 0, { x: 1, y: 0, z: 2 });
    expect(picked[0]!.checkpoint).toEqual({ order: 1, respawn: { x: 1, y: 0, z: 2 } });
    expect(setCheckpointRespawn(picked, 0, undefined)[0]!.checkpoint).toEqual({ order: 1 });
    expect(setCheckpointRespawn(track, 1, { x: 0, y: 0, z: 0 })[1]).toEqual(track[1]);
  });

  it("keeps Start and Checkpoint through a re-chain", () => {
    const chained: Track = [
      floor(0),
      { ...floor(0), start: true, checkpoint: { order: 1 } },
    ];
    const rechained = rechainFrom(chained, LIBRARY, 1);
    expect(rechained[1]!.start).toBe(true);
    expect(rechained[1]!.checkpoint).toEqual({ order: 1 });
  });
});

describe("a respawn spot in the gate's own frame", () => {
  it("inverts the Segment's placement, turn and scale included", () => {
    const segment = { ...arch(0), position: { x: 10, y: 2, z: -4 }, rotation: Math.PI / 2, pitch: 0.2, scale: 2 };
    const local = { x: 1, y: 0.5, z: -1.5 };
    const world = addVec3(segment.position, rotateVec3ByQuat(scaleVec3(local, 2), segmentOrientation(segment)));
    const back = worldToSegmentLocal(segment, world);
    expect(back.x).toBeCloseTo(local.x, 9);
    expect(back.y).toBeCloseTo(local.y, 9);
    expect(back.z).toBeCloseTo(local.z, 9);
  });
});

describe("the course summary", () => {
  it("lists the Start, Checkpoints in run order and every finish sign — switched-off gates aren't Checkpoints", () => {
    const track: Track = [
      { ...floor(0), start: true },
      { ...arch(4), checkpoint: { order: 2 } },
      arch(8),
      { ...arch(12), checkpoint: { order: 1 } },
      { moduleId: "kaykit_signage_finish", position: { x: 16, y: 0, z: 0 }, rotation: 0 },
    ];
    expect(courseOf(track, LIBRARY)).toEqual({
      start: 0,
      checkpoints: [{ index: 3, order: 1 }, { index: 1, order: 2 }],
      finishes: [4],
    });
  });

  it("locks Motion on a Start, a Checkpoint and a finish sign, and nothing else", () => {
    expect(motionLockReason({ ...floor(0), start: true }, LIBRARY)).toMatch(/Start/);
    expect(motionLockReason({ ...arch(0), checkpoint: { order: 1 } }, LIBRARY)).toMatch(/Checkpoint/);
    expect(motionLockReason({ moduleId: "kaykit_signage_finish", position: { x: 0, y: 0, z: 0 }, rotation: 0 }, LIBRARY)).toMatch(/finish/);
    expect(motionLockReason(arch(0), LIBRARY)).toBeUndefined();
    expect(motionLockReason(floor(0), LIBRARY)).toBeUndefined();
  });
});
