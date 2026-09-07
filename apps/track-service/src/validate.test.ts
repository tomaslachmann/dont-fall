import type { Module, Track } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { MAX_SURVIVOR_TARGET, MIN_SURVIVOR_TARGET } from "@dont-fall/shared";
import { invalidSurvivorTargetReason, unknownModuleIds } from "./validate.js";

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

describe("invalidSurvivorTargetReason (M5 ticket 07, ADR 0041)", () => {
  it("accepts an omitted target — a publish that doesn't author one takes the default", () => {
    expect(invalidSurvivorTargetReason(undefined)).toBeUndefined();
  });

  it("accepts the floor and the ceiling themselves", () => {
    expect(invalidSurvivorTargetReason(MIN_SURVIVOR_TARGET)).toBeUndefined();
    expect(invalidSurvivorTargetReason(MAX_SURVIVOR_TARGET)).toBeUndefined();
  });

  it("rejects a target of nobody — a Survival Round has to be survivable", () => {
    expect(invalidSurvivorTargetReason(MIN_SURVIVOR_TARGET - 1)).toMatch(/survivorTarget/);
  });

  it("rejects a target past the Player ceiling, where the Round would end before it started", () => {
    expect(invalidSurvivorTargetReason(MAX_SURVIVOR_TARGET + 1)).toMatch(/survivorTarget/);
  });

  it("rejects a fraction of a Player, and a number that is really a string", () => {
    expect(invalidSurvivorTargetReason(2.5)).toMatch(/whole number/);
    expect(invalidSurvivorTargetReason("2")).toMatch(/whole number/);
  });
});
