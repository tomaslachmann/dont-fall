import { describe, expect, it } from "vitest";
import {
  chevronPose,
  diveY,
  foldDepth,
  foldPitch,
  foldRetreat,
  FOLD_RETREAT,
  marchZ,
  stripLayout,
} from "./conveyorStrip.js";

describe("stripLayout (ADR 0064)", () => {
  it("lays a real grid on a roomy deck — 6×8 units hold rows of chevrons at full size", () => {
    const layout = stripLayout(4, 3);
    expect(layout.unit).toBe(1);
    expect(layout.perRow).toBe(5);
    expect(layout.rows).toBe(4);
    expect(layout.span).toBeCloseTo(8, 10);
    expect(layout.laterals).toHaveLength(4);
    expect(layout.laterals[0]).toBeCloseTo(-2.25, 10);
    expect(layout.laterals[3]).toBeCloseTo(2.25, 10);
  });

  it("shrinks to one small chevron on a 1×1 deck instead of overcrowding it", () => {
    const layout = stripLayout(0.5, 0.5);
    expect(layout.unit).toBeLessThan(1);
    expect(layout.perRow).toBe(1);
    expect(layout.rows).toBe(1);
    expect(layout.laterals).toEqual([0]);
  });

  it("caps the grid so a 12×12 deck never spawns hundreds of chevrons", () => {
    const layout = stripLayout(15, 15);
    expect(layout.perRow).toBe(6);
    expect(layout.rows).toBe(4);
  });

  it("stretches the pitch so the grid spans the deck edge to edge — the strip copies the deck edge", () => {
    // halfL 2 holds 2 base pitches (1.6) with room left: the counts fit
    // first (2 per row), then the pitch stretches to cover the full extent.
    const layout = stripLayout(2, 1);
    expect(layout.perRow).toBe(2);
    expect(layout.spacing).toBeCloseTo(2, 10);
    expect(layout.span).toBeCloseTo(4, 10);
    expect(layout.edge).toBeCloseTo(1, 10); // outermost chevrons half a stretched pitch inside each edge
    expect(layout.rows).toBe(1);
    expect(layout.rowGap).toBeCloseTo(2, 10);
  });

  it("stretches even a capped grid — sparse on a 12×12 deck, but covering the whole belt", () => {
    const layout = stripLayout(15, 15);
    expect(layout.spacing).toBeCloseTo(5, 10);
    expect(layout.span).toBeCloseTo(30, 10);
    expect(layout.rowGap).toBeCloseTo(7.5, 10);
    expect(Math.max(...layout.laterals.map(Math.abs))).toBeLessThan(15);
  });
});

describe("marchZ (ADR 0064)", () => {
  const layout = stripLayout(4, 3);

  it("rests symmetric about the deck centre — first chevron at +edge, last at −edge", () => {
    expect(marchZ(layout, 0, 0)).toBeCloseTo(layout.edge, 10);
    expect(marchZ(layout, layout.perRow - 1, 0)).toBeCloseTo(-layout.edge, 10);
  });

  it("marches every chevron toward −Z (the flow) by exactly the phase, modulo the wrap", () => {
    for (let i = 0; i < layout.perRow; i += 1) {
      const travelled = marchZ(layout, i, 0) - marchZ(layout, i, 0.4);
      const wrapped = Math.abs(travelled - (0.4 - layout.span)) < 1e-9;
      expect(wrapped || Math.abs(travelled - 0.4) < 1e-9).toBe(true);
    }
  });

  it("never leaves ±span/2 — chevrons stay over their own deck at any phase", () => {
    for (const phase of [0, 0.7, 2.3, 5.1, 9.9, 100.25]) {
      for (let i = 0; i < layout.perRow; i += 1) {
        expect(Math.abs(marchZ(layout, i, phase))).toBeLessThanOrEqual(layout.span / 2 + 1e-9);
      }
    }
  });

  it("keeps an even rhythm across the wrap — every neighbour gap is one spacing", () => {
    for (const phase of [0, 0.4, 1.7]) {
      const zs = Array.from({ length: layout.perRow }, (_, i) => marchZ(layout, i, phase)).sort((a, b) => a - b);
      for (let k = 1; k < zs.length; k += 1) {
        expect(zs[k]! - zs[k - 1]!).toBeCloseTo(layout.spacing, 9);
      }
    }
  });
});

describe("diveY (ADR 0064)", () => {
  const layout = stripLayout(4, 3); // span 8, spacing 1.6 — the roomy deck
  const half = layout.span / 2;

  it("rides at deck level mid-travel, symmetric about the centre", () => {
    expect(diveY(layout, 0)).toBe(0);
    expect(diveY(layout, 1)).toBe(0);
    expect(diveY(layout, -2)).toBe(0);
    expect(diveY(layout, 2.5)).toBe(diveY(layout, -2.5));
  });

  it("sits at full fold depth exactly at both travel ends — the wrap hides inside the deck", () => {
    expect(diveY(layout, half)).toBe(-foldDepth(layout));
    expect(diveY(layout, -half)).toBe(-foldDepth(layout));
  });

  it("ramps monotonically from the end into the flat — no step, no overshoot", () => {
    let previous = -foldDepth(layout);
    for (let d = 0; d <= 1; d += 0.05) {
      const y = diveY(layout, -half + d);
      expect(y).toBeGreaterThanOrEqual(previous - 1e-12);
      expect(y).toBeLessThanOrEqual(0);
      previous = y;
    }
    expect(diveY(layout, -half + 1)).toBe(0); // fully surfaced past the envelope
  });

  it("narrows the fold on a 1×1 deck so the lone chevron still rides flat mid-travel", () => {
    const tiny = stripLayout(0.5, 0.5);
    expect(diveY(tiny, 0)).toBe(0);
    expect(diveY(tiny, tiny.span / 2)).toBe(-foldDepth(tiny));
    expect(diveY(tiny, -tiny.span / 2)).toBe(-foldDepth(tiny));
  });
});

describe("foldDepth (ADR 0064)", () => {
  it("buries a vertical glyph: its half-reach plus clearance for the lift and the deck bevel", () => {
    expect(foldDepth(stripLayout(4, 3))).toBeCloseTo(0.41 + 0.08, 10);
  });

  it("scales with the glyph — a shrunk chevron folds shallower", () => {
    const tiny = stripLayout(0.5, 0.5);
    expect(foldDepth(tiny)).toBeCloseTo(0.41 * tiny.unit + 0.08, 10);
    expect(foldDepth(tiny)).toBeLessThan(foldDepth(stripLayout(4, 3)));
  });
});

describe("foldPitch (ADR 0064)", () => {
  const layout = stripLayout(4, 3);
  const half = layout.span / 2;

  it("rides flat mid-travel, symmetric about the centre", () => {
    expect(foldPitch(layout, 0)).toBe(0);
    expect(foldPitch(layout, 1.5)).toBe(0);
    expect(foldPitch(layout, 2.5)).toBe(foldPitch(layout, -2.5));
  });

  it("reaches a nose-down quarter turn exactly at both travel ends — the fold over the edge", () => {
    expect(foldPitch(layout, half)).toBeCloseTo(-Math.PI / 2, 10);
    expect(foldPitch(layout, -half)).toBeCloseTo(-Math.PI / 2, 10);
  });

  it("eases monotonically from the end into the flat — one bend, no wobble", () => {
    let previous = -Math.PI / 2;
    for (let d = 0; d <= 1; d += 0.05) {
      const pitch = foldPitch(layout, -half + d);
      expect(pitch).toBeGreaterThanOrEqual(previous - 1e-12);
      expect(pitch).toBeLessThanOrEqual(0);
      previous = pitch;
    }
    expect(foldPitch(layout, -half + 1)).toBe(0);
  });
});

describe("foldRetreat (ADR 0064)", () => {
  const layout = stripLayout(4, 3);
  const half = layout.span / 2;

  it("sits at 0 mid-travel — the march rhythm is untouched where chevrons ride flat", () => {
    expect(foldRetreat(layout, 0)).toBe(0);
    expect(foldRetreat(layout, 2)).toBe(0);
    expect(foldRetreat(layout, -2)).toBe(0);
  });

  it("pulls toward the centre at both travel ends — the folded glyph never sits on the side face", () => {
    expect(foldRetreat(layout, half)).toBeCloseTo(-FOLD_RETREAT, 10);
    expect(foldRetreat(layout, -half)).toBeCloseTo(FOLD_RETREAT, 10);
  });

  it("never exceeds the retreat — too small to read as a rhythm stutter", () => {
    for (let z = -half; z <= half; z += 0.1) {
      expect(Math.abs(foldRetreat(layout, z))).toBeLessThanOrEqual(FOLD_RETREAT + 1e-12);
    }
  });
});

describe("chevronPose (ADR 0064)", () => {
  const layout = stripLayout(4, 3); // span 8, edge 3.2, fold envelope 0.48 — the roomy deck

  it("rests flat — every rest chevron sits half a pitch inside the wrap, outside the fold", () => {
    for (let i = 0; i < layout.perRow; i += 1) {
      const pose = chevronPose(layout, i, 0);
      expect(pose.z).toBe(marchZ(layout, i, 0)); // no pullback in the flat
      expect(pose.y).toBe(0);
      expect(pose.pitch).toBe(0);
    }
  });

  it("composes the march with the fold — one call, never disagreeing about the z-space", () => {
    // Phase 7.44 wraps chevron 0 to z 3.76, mid-fold (endness exactly 1/2) at the entry end.
    const pose = chevronPose(layout, 0, 7.44);
    const march = marchZ(layout, 0, 7.44);
    expect(march).toBeCloseTo(3.76, 9);
    expect(pose.z).toBeCloseTo(march + foldRetreat(layout, march), 10);
    expect(pose.y).toBeCloseTo(diveY(layout, march), 10);
    expect(pose.pitch).toBeCloseTo(foldPitch(layout, march), 10);
    // ... and mid-fold reads as half on top, half bent down: sunk halfway, pitched halfway.
    expect(pose.y).toBeCloseTo(-foldDepth(layout) / 2, 9);
    expect(pose.pitch).toBeCloseTo(-Math.PI / 4, 9);
  });

  it("is pose-continuous across the wrap — the same depth and pitch at both ends", () => {
    // The wrap instant (phase span − spacing/2) lands exactly on +span/2…
    const wrapPhase = layout.span - layout.spacing / 2;
    expect(marchZ(layout, 0, wrapPhase)).toBeCloseTo(layout.span / 2, 9);
    const atWrap = chevronPose(layout, 0, wrapPhase);
    expect(atWrap.y).toBe(-foldDepth(layout));
    expect(atWrap.pitch).toBeCloseTo(-Math.PI / 2, 10);
    // …carrying the identical fold the exit end had an instant before — only the buried z jumps.
    expect(diveY(layout, -layout.span / 2)).toBe(atWrap.y);
    expect(foldPitch(layout, -layout.span / 2)).toBeCloseTo(atWrap.pitch, 10);
  });
});
