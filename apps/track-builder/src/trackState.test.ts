import { MODULE_STEP, type Track } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { appendModule, removeLast } from "./trackState.js";

describe("appendModule", () => {
  it("places the first Segment at the origin", () => {
    const track = appendModule([], "start");
    expect(track).toEqual([{ moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: 0 }]);
  });

  it("places each following Segment MODULE_STEP after the last — no gaps/overlaps by construction (ADR 0030)", () => {
    const track = appendModule(appendModule([], "start"), "bridge");
    expect(track[1]!.position).toEqual({ x: MODULE_STEP.x, y: MODULE_STEP.y, z: MODULE_STEP.z });
    expect(track[1]!.rotation).toBe(0);
  });

  it("does not mutate the input Track", () => {
    const original: Track = [{ moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: 0 }];
    const appended = appendModule(original, "bridge");
    expect(original).toHaveLength(1);
    expect(appended).toHaveLength(2);
  });
});

describe("removeLast", () => {
  it("removes the most recently placed Segment", () => {
    const track = appendModule(appendModule([], "start"), "bridge");
    expect(removeLast(track)).toEqual([track[0]]);
  });

  it("is a no-op on an empty Track", () => {
    expect(removeLast([])).toEqual([]);
  });
});
