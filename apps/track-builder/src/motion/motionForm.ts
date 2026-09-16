import type { Box, MotionSlide, MotionSpin, MotionSwing, Module, Vec3 } from "@dont-fall/shared";

/**
 * Where a Spin or Swing turns about, named off the Module's Footprint (ADR
 * 0061) — every Asset sits on the pivot convention (X/Z centred, resting on
 * y = 0), so these land on the shapes' own features: a carousel spins about
 * its `centre`, a seesaw about its `base`, a hammer swings from an `end`.
 */
export const PIVOT_PRESETS = ["centre", "base", "top", "-x end", "+x end", "-z end", "+z end"] as const;
export type PivotPreset = (typeof PIVOT_PRESETS)[number];

export const pivotPreset = (module: Module, preset: PivotPreset): Vec3 => {
  const { center: c, halfExtents: h } = module.footprint.bounds;
  switch (preset) {
    case "centre":
      return { ...c };
    case "base":
      return { x: c.x, y: c.y - h.y, z: c.z };
    case "top":
      return { x: c.x, y: c.y + h.y, z: c.z };
    case "-x end":
      return { x: c.x - h.x, y: c.y, z: c.z };
    case "+x end":
      return { x: c.x + h.x, y: c.y, z: c.z };
    case "-z end":
      return { x: c.x, y: c.y, z: c.z - h.z };
    case "+z end":
      return { x: c.x, y: c.y, z: c.z + h.z };
  }
};

export const AXES = { X: { x: 1, y: 0, z: 0 }, Y: { x: 0, y: 1, z: 0 }, Z: { x: 0, y: 0, z: 1 } } as const;
export type AxisName = keyof typeof AXES;

/** The named axis an authored axis vector is closest to — how the panel shows it. */
export const nearestAxis = (axis: Vec3): AxisName => {
  const ax = Math.abs(axis.x);
  const ay = Math.abs(axis.y);
  const az = Math.abs(axis.z);
  if (ay >= ax && ay >= az) return "Y";
  return ax >= az ? "X" : "Z";
};

export const toDegrees = (radians: number): number => Math.round(((radians * 180) / Math.PI) * 100) / 100;
export const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** A carousel: a slow quarter-ish turn per second about the vertical through the centre. */
export const defaultSpin = (module: Module): MotionSpin => ({
  axis: { ...AXES.Y },
  pivot: pivotPreset(module, "centre"),
  speed: toRadians(90),
});

/** A hammer: ±60° about a horizontal axis through the top, over two seconds, pendulum-eased. */
export const defaultSwing = (module: Module): MotionSwing => ({
  axis: { ...AXES.Z },
  pivot: pivotPreset(module, "top"),
  amplitude: toRadians(60),
  period: 2,
  easing: "easeInOut",
});

/** A moving platform: across its own width and back over four seconds, with a short hold at each end. */
export const defaultSlide = (module: Module): MotionSlide => ({
  offset: { x: Math.max(1, module.footprint.bounds.halfExtents.x * 2), y: 0, z: 0 },
  period: 4,
  easing: "easeInOut",
  pause: 0.5,
});

/** A number field's value, or `fallback` for an empty/garbled one — the panel never writes NaN into a Track. */
export const readNumber = (text: string, fallback: number): number => {
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value : fallback;
};

/**
 * The pivot grid (M11 ticket 06 follow-up): a 3 × 3 top-down pick over the
 * Footprint — the four corners, the middles of the four sides, the centre.
 * `col` runs −1..1 along local x (left → right), `row` −1..1 along local z
 * with −1 at the front: a Track chains toward −Z, so −Z is where the piece
 * faces. It moves the pivot across the piece and leaves its height alone.
 */
export const GRID_STEPS = [-1, 0, 1] as const;
export type GridStep = (typeof GRID_STEPS)[number];

export const gridPivot = (module: Module, height: number, col: GridStep, row: GridStep): Vec3 => {
  const { center: c, halfExtents: h } = module.footprint.bounds;
  return { x: c.x + col * h.x, y: height, z: c.z + row * h.z };
};

/** The grid cell `pivot` sits on, if it sits on one. */
export const gridCellOf = (module: Module, pivot: Vec3): { col: GridStep; row: GridStep } | undefined => {
  for (const row of GRID_STEPS) {
    for (const col of GRID_STEPS) {
      const cell = gridPivot(module, pivot.y, col, row);
      if (Math.abs(cell.x - pivot.x) < 1e-6 && Math.abs(cell.z - pivot.z) < 1e-6) return { col, row };
    }
  }
  return undefined;
};

/** The piece's longer horizontal direction — where "along its length" points. */
export const lengthAxis = (module: Module): "X" | "Z" =>
  module.footprint.bounds.halfExtents.z >= module.footprint.bounds.halfExtents.x ? "Z" : "X";

const across = (axis: "X" | "Z"): "X" | "Z" => (axis === "X" ? "Z" : "X");

/** The front end of the piece along `axis` (−x or −z end), at the centre's height. */
const frontEnd = (module: Module, axis: "X" | "Z"): Vec3 => pivotPreset(module, axis === "X" ? "-x end" : "-z end");

/**
 * Whole Spin set-ups in one click, named for what they look like rather than
 * for axes: a carousel turns flat about its centre, an arm sweeps flat about
 * one end, a drum rolls about its length or its width.
 */
export const SPIN_SHAPES = ["carousel", "arm", "drum along", "drum across"] as const;
export type SpinShape = (typeof SPIN_SHAPES)[number];

/**
 * The post a multi-part piece stands on, if it has one: a part resting on the
 * piece's base and taller than it is wide — the wooden upright of a sweeper
 * (`trap_trapcircle*`), which the arm turns about. Of several, the most
 * post-like (tallest for its width). A single-part piece has no separate post.
 * `parts` are the piece's mesh bounds in its own frame (`templateParts`).
 */
export const findPost = (module: Module, parts: readonly Box[]): Box | undefined => {
  if (parts.length < 2) return undefined;
  const base = module.footprint.bounds.center.y - module.footprint.bounds.halfExtents.y;
  const slenderness = (part: Box): number => part.halfExtents.y / Math.max(part.halfExtents.x, part.halfExtents.z, 1e-6);
  return parts
    .filter((part) => Math.abs(part.center.y - part.halfExtents.y - base) < 0.05 && slenderness(part) >= 1)
    .sort((a, b) => slenderness(b) - slenderness(a))[0];
};

export const spinShape = (module: Module, shape: SpinShape, parts: readonly Box[] = []): { axis: Vec3; pivot: Vec3 } => {
  const length = lengthAxis(module);
  switch (shape) {
    case "carousel":
      return { axis: { ...AXES.Y }, pivot: pivotPreset(module, "centre") };
    case "arm": {
      // About its post when it has one, so the post turns on the spot and the
      // arm sweeps round it; otherwise about the front end.
      const post = findPost(module, parts);
      const centre = pivotPreset(module, "centre");
      return { axis: { ...AXES.Y }, pivot: post ? { x: post.center.x, y: centre.y, z: post.center.z } : frontEnd(module, length) };
    }
    case "drum along":
      return { axis: { ...AXES[length] }, pivot: pivotPreset(module, "centre") };
    case "drum across":
      return { axis: { ...AXES[across(length)] }, pivot: pivotPreset(module, "centre") };
  }
};

/**
 * Whole Swing set-ups in one click: a pendulum hangs from its top, a hammer
 * swings up and down from one end, a seesaw rocks on the middle of its base —
 * each turning across the piece's length, so the long side is what moves.
 */
export const SWING_SHAPES = ["pendulum", "hammer", "seesaw"] as const;
export type SwingShape = (typeof SWING_SHAPES)[number];

export const swingShape = (module: Module, shape: SwingShape): { axis: Vec3; pivot: Vec3 } => {
  const length = lengthAxis(module);
  const axis = { ...AXES[across(length)] };
  switch (shape) {
    case "pendulum":
      return { axis, pivot: pivotPreset(module, "top") };
    case "hammer":
      return { axis, pivot: frontEnd(module, length) };
    case "seesaw":
      return { axis, pivot: pivotPreset(module, "base") };
  }
};

/** Which one-click shape an axis + pivot is, if it is one — so the panel can light it up. */
export const matchShape = <S extends string>(
  shapes: readonly S[],
  build: (shape: S) => { axis: Vec3; pivot: Vec3 },
  axis: Vec3,
  pivot: Vec3,
): S | undefined =>
  shapes.find((shape) => {
    const s = build(shape);
    const d = (a: Vec3, b: Vec3) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
    return d(s.axis, axis) < 1e-6 && d(s.pivot, pivot) < 1e-6;
  });
