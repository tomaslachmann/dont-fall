import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEGMENT_COLOR,
  invalidSegmentColorReason,
  isSegmentColorId,
  SEGMENT_COLOR_HUES,
  SEGMENT_COLORS,
} from "./SegmentColor.js";

describe("SegmentColor — a Segment's paint", () => {
  it("holds 8 hues, the 4 authored KayKit ones included", () => {
    expect(SEGMENT_COLORS).toHaveLength(8);
    for (const legacy of ["red", "blue", "green", "yellow"]) {
      expect(SEGMENT_COLORS).toContain(legacy);
    }
    expect(new Set(SEGMENT_COLORS).size).toBe(8);
  });

  it("aims every hue at a distinct target, red at the canonical file's own 0", () => {
    expect(Object.keys(SEGMENT_COLOR_HUES).sort()).toEqual([...SEGMENT_COLORS].sort());
    expect(SEGMENT_COLOR_HUES.red).toBe(0);
    expect(new Set(Object.values(SEGMENT_COLOR_HUES)).size).toBe(8);
  });

  it("defaults fresh placements to the canonical file's own color (no shift)", () => {
    expect(DEFAULT_SEGMENT_COLOR).toBe("red");
    expect(isSegmentColorId(DEFAULT_SEGMENT_COLOR)).toBe(true);
  });

  it("refuses anything but the 8 ids, naming them", () => {
    expect(invalidSegmentColorReason("pink")).toBeUndefined();
    expect(invalidSegmentColorReason("magenta")).toMatch(/^color must be one of red, orange, yellow, green, cyan, blue, purple, pink/);
    expect(invalidSegmentColorReason(true)).toMatch(/^color must be one of/);
    expect(invalidSegmentColorReason(null)).toMatch(/^color must be one of/);
  });
});
