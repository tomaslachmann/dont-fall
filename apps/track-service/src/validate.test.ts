import type { Module, Track } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { unknownModuleIds } from "./validate.js";

const MODULES: Record<string, Module> = {
  start: {
    id: "start",
    statics: [],
    sockets: [
      { id: "entry", type: "floor", position: { x: 0, y: 0, z: 3 }, yaw: Math.PI },
      { id: "exit", type: "floor", position: { x: 0, y: -0.5, z: -3 }, yaw: 0 },
    ],
    footprint: { bounds: { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 3, y: 1, z: 3 } }, clearance: 0.5 },
  },
};

describe("unknownModuleIds", () => {
  it("is empty for a Track that only references real Modules", () => {
    const track: Track = [{ moduleId: "start", position: { x: 0, y: 0, z: 0 }, rotation: 0 }];
    expect(unknownModuleIds(track, MODULES)).toEqual([]);
  });

  it("lists a moduleId that doesn't exist in the library", () => {
    const track: Track = [{ moduleId: "not-real", position: { x: 0, y: 0, z: 0 }, rotation: 0 }];
    expect(unknownModuleIds(track, MODULES)).toEqual(["not-real"]);
  });

  it("de-duplicates a repeated unknown moduleId", () => {
    const track: Track = [
      { moduleId: "ghost", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
      { moduleId: "ghost", position: { x: 0, y: 0, z: -6 }, rotation: 0 },
    ];
    expect(unknownModuleIds(track, MODULES)).toEqual(["ghost"]);
  });

  it("is empty for an empty Track", () => {
    expect(unknownModuleIds([], MODULES)).toEqual([]);
  });

  it("rejects a moduleId that only matches an inherited Object.prototype property (code review)", () => {
    const track: Track = [
      { moduleId: "toString", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
      { moduleId: "constructor", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
      { moduleId: "hasOwnProperty", position: { x: 0, y: 0, z: 0 }, rotation: 0 },
    ];
    expect(unknownModuleIds(track, MODULES)).toEqual(
      expect.arrayContaining(["toString", "constructor", "hasOwnProperty"]),
    );
  });
});
