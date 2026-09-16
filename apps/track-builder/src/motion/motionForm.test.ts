import { invalidMotionReason, type Module } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import {
  defaultSlide,
  defaultSpin,
  defaultSwing,
  findPost,
  gridCellOf,
  gridPivot,
  lengthAxis,
  matchShape,
  nearestAxis,
  SPIN_SHAPES,
  spinShape,
  SWING_SHAPES,
  swingShape,
  PIVOT_PRESETS,
  pivotPreset,
  readNumber,
  toDegrees,
  toRadians,
} from "./motionForm.js";

// A hammer-ish Asset seated on the pivot convention: 1 wide, 2 tall, 6 long.
const HAMMER: Module = {
  id: "hammer",
  statics: [],
  sockets: [],
  footprint: { bounds: { center: { x: 0, y: 1, z: 0 }, halfExtents: { x: 0.5, y: 1, z: 3 } }, clearance: 0.5 },
};

describe("pivotPreset", () => {
  it("names the Footprint's own features", () => {
    expect(pivotPreset(HAMMER, "centre")).toEqual({ x: 0, y: 1, z: 0 });
    expect(pivotPreset(HAMMER, "base")).toEqual({ x: 0, y: 0, z: 0 });
    expect(pivotPreset(HAMMER, "top")).toEqual({ x: 0, y: 2, z: 0 });
    expect(pivotPreset(HAMMER, "-z end")).toEqual({ x: 0, y: 1, z: -3 });
    expect(pivotPreset(HAMMER, "+x end")).toEqual({ x: 0.5, y: 1, z: 0 });
  });

  it("covers every preset the panel offers", () => {
    for (const preset of PIVOT_PRESETS) expect(Number.isFinite(pivotPreset(HAMMER, preset).y)).toBe(true);
  });
});

describe("defaults", () => {
  it("are Motions the API would store", () => {
    expect(invalidMotionReason({ spin: defaultSpin(HAMMER) })).toBeUndefined();
    expect(invalidMotionReason({ swing: defaultSwing(HAMMER) })).toBeUndefined();
    expect(invalidMotionReason({ slide: defaultSlide(HAMMER) })).toBeUndefined();
  });

  it("slide a piece across its own width", () => {
    expect(defaultSlide(HAMMER).offset.x).toBe(1);
  });
});

describe("conversions", () => {
  it("round-trips degrees for display", () => {
    expect(toDegrees(toRadians(90))).toBe(90);
    expect(toDegrees(Math.PI / 3)).toBe(60);
  });

  it("names the nearest axis", () => {
    expect(nearestAxis({ x: 0, y: -1, z: 0 })).toBe("Y");
    expect(nearestAxis({ x: 0.2, y: 0.1, z: 0.9 })).toBe("Z");
    expect(nearestAxis({ x: 1, y: 0, z: 0 })).toBe("X");
  });

  it("never reads a garbled field as NaN", () => {
    expect(readNumber("2.5", 1)).toBe(2.5);
    expect(readNumber("", 1)).toBe(1);
    expect(readNumber("abc", 7)).toBe(7);
  });
});

describe("the pivot grid", () => {
  it("picks corners, side middles and the centre across the top view, keeping the height", () => {
    expect(gridPivot(HAMMER, 0.5, 0, 0)).toEqual({ x: 0, y: 0.5, z: 0 });
    expect(gridPivot(HAMMER, 0.5, 0, -1)).toEqual({ x: 0, y: 0.5, z: -3 }); // front middle
    expect(gridPivot(HAMMER, 0.5, 1, 1)).toEqual({ x: 0.5, y: 0.5, z: 3 }); // back-right corner
  });

  it("finds the cell a pivot sits on, whatever its height", () => {
    expect(gridCellOf(HAMMER, { x: -0.5, y: 7, z: -3 })).toEqual({ col: -1, row: -1 });
    expect(gridCellOf(HAMMER, { x: 0.2, y: 1, z: 0 })).toBeUndefined();
  });
});

describe("one-click shapes", () => {
  it("reads the piece's length off its Footprint", () => {
    expect(lengthAxis(HAMMER)).toBe("Z");
  });

  it("builds a carousel, an arm and two drums", () => {
    expect(spinShape(HAMMER, "carousel")).toEqual({ axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 1, z: 0 } });
    expect(spinShape(HAMMER, "arm")).toEqual({ axis: { x: 0, y: 1, z: 0 }, pivot: { x: 0, y: 1, z: -3 } });
    expect(spinShape(HAMMER, "drum along").axis).toEqual({ x: 0, y: 0, z: 1 });
    expect(spinShape(HAMMER, "drum across").axis).toEqual({ x: 1, y: 0, z: 0 });
  });

  it("swings across the length: a hammer from its front end, a seesaw on its base", () => {
    expect(swingShape(HAMMER, "hammer")).toEqual({ axis: { x: 1, y: 0, z: 0 }, pivot: { x: 0, y: 1, z: -3 } });
    expect(swingShape(HAMMER, "seesaw").pivot).toEqual({ x: 0, y: 0, z: 0 });
    expect(swingShape(HAMMER, "pendulum").pivot).toEqual({ x: 0, y: 2, z: 0 });
  });

  it("recognises a shape back from its axis and pivot, and nothing else", () => {
    const arm = spinShape(HAMMER, "arm");
    expect(matchShape(SPIN_SHAPES, (s) => spinShape(HAMMER, s), arm.axis, arm.pivot)).toBe("arm");
    expect(matchShape(SWING_SHAPES, (s) => swingShape(HAMMER, s), arm.axis, { x: 9, y: 9, z: 9 })).toBeUndefined();
  });
});

describe("pieces with a post (trap_trapcircle*)", () => {
  // Measured off trap_trapcircleblue: an upright at z ≈ 0.65 and an arm along −z.
  const SWEEPER: Module = {
    id: "sweeper",
    statics: [],
    sockets: [],
    footprint: { bounds: { center: { x: 0, y: 0.411, z: 0 }, halfExtents: { x: 0.205, y: 0.411, z: 0.85 } }, clearance: 0.5 },
  };
  const POST = { center: { x: -0.003, y: 0.411, z: 0.65 }, halfExtents: { x: 0.2, y: 0.411, z: 0.2 } };
  const ARM = { center: { x: 0.016, y: 0.448, z: -0.014 }, halfExtents: { x: 0.19, y: 0.18, z: 0.836 } };

  it("finds the upright standing on the base, not the arm held above it", () => {
    expect(findPost(SWEEPER, [ARM, POST])).toBe(POST);
    expect(findPost(SWEEPER, [ARM])).toBeUndefined();
    expect(findPost(HAMMER, [])).toBeUndefined();
  });

  it("sweeps an Arm about the post, so the post turns on the spot", () => {
    const arm = spinShape(SWEEPER, "arm", [ARM, POST]);
    expect(arm.pivot.x).toBeCloseTo(-0.003);
    expect(arm.pivot.z).toBeCloseTo(0.65);
    // Without its parts known it can only fall back to the front end.
    expect(spinShape(SWEEPER, "arm").pivot.z).toBeCloseTo(-0.85);
  });
});
