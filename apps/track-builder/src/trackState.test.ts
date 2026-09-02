import type { Module, Track } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { appendModule, removeLast } from "./trackState.js";

const straightModule = (id: string): Module => ({
  id,
  statics: [{ center: { x: 0, y: -0.5, z: 0 }, halfExtents: { x: 3, y: 0.5, z: 3 } }],
  sockets: [
    { id: "entry", type: "floor", position: { x: 0, y: 0, z: 3 }, yaw: Math.PI },
    { id: "exit", type: "floor", position: { x: 0, y: -0.5, z: -3 }, yaw: 0 },
  ],
  footprint: { bounds: { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 3, y: 1, z: 3 } }, clearance: 0.5 },
});

const MODULES = { start: straightModule("start"), bridge: straightModule("bridge") };

describe("appendModule", () => {
  it("places the first Segment at the origin", () => {
    const track = appendModule([], "start", MODULES);
    expect(track).toEqual([{ moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: 0 }]);
  });

  it("places each following Segment via Socket alignment — no gaps/overlaps by construction (ADR 0031)", () => {
    const track = appendModule(appendModule([], "start", MODULES), "bridge", MODULES);
    expect(track[1]!.position).toEqual({ x: 0, y: -0.5, z: -6 });
    expect(track[1]!.rotation).toBe(0);
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

describe("removeLast", () => {
  it("removes the most recently placed Segment", () => {
    const track = appendModule(appendModule([], "start", MODULES), "bridge", MODULES);
    expect(removeLast(track)).toEqual([track[0]]);
  });

  it("is a no-op on an empty Track", () => {
    expect(removeLast([])).toEqual([]);
  });
});
