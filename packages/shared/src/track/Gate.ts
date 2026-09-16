import type { Quat } from "../math/quat.js";
import { addVec3, dotVec3, rotateVec3ByQuat, scaleVec3, subVec3, type Vec3 } from "../math/vec3.js";

/**
 * What passing through a Gate does (CONTEXT.md: Gate, ADR 0068): a hoop or an
 * arch can be switched on as a Checkpoint, a finish sign always Qualifies.
 */
export type GateRole = "checkpoint" | "finish";

/**
 * A Gate Asset's opening, fitted at build time (`scripts/fit-gates.ts`) and
 * stored in its own frame: a grid of cells on a plane, each cell open (a
 * Character can pass there) or not.
 *
 * The plane's frame is the Asset's, tilted about its X axis by `tilt`:
 * across `u = (1, 0, 0)`, up `v = (0, cos t, −sin t)`, through
 * `n = (0, sin t, cos t)` — every Gate in both packs faces ±Z, a hoop leaning
 * back included.
 */
export interface GateOpening {
  tilt: number;
  /** Corner of cell (0, 0) on the plane, in the Asset frame. */
  origin: Vec3;
  /** Cell size, in Asset units. */
  cell: number;
  cols: number;
  rows: number;
  /** Open cells, row-major from `origin` (row 0 lowest), one bit each, most significant first, as hex. */
  mask: string;
  /** The opening's centre (the centroid of its cells), in the Asset frame. */
  center: Vec3;
}

export interface GateDef {
  role: GateRole;
  opening: GateOpening;
}

/** A Gate opening placed in the world: its plane frame and the mask decoded once. */
export interface PlacedGate {
  origin: Vec3;
  u: Vec3;
  v: Vec3;
  n: Vec3;
  cell: number;
  cols: number;
  rows: number;
  open: Uint8Array;
  /** The opening's centre, world space. */
  center: Vec3;
}

/** The opening's plane axes in the Asset frame. */
export const gateAxes = (tilt: number): { u: Vec3; v: Vec3; n: Vec3 } => ({
  u: { x: 1, y: 0, z: 0 },
  v: { x: 0, y: Math.cos(tilt), z: -Math.sin(tilt) },
  n: { x: 0, y: Math.sin(tilt), z: Math.cos(tilt) },
});

/** Hex mask → one byte per cell (1 open). */
export const decodeGateMask = (mask: string, cells: number): Uint8Array => {
  const open = new Uint8Array(cells);
  for (let i = 0; i < cells; i += 1) {
    const nibble = Number.parseInt(mask[i >> 2] ?? "0", 16);
    open[i] = (nibble >> (3 - (i & 3))) & 1;
  }
  return open;
};

/** One byte per cell → hex mask, the inverse of {@link decodeGateMask}. */
export const encodeGateMask = (open: ArrayLike<number>): string => {
  let hex = "";
  for (let i = 0; i < open.length; i += 4) {
    let nibble = 0;
    for (let b = 0; b < 4; b += 1) nibble = (nibble << 1) | (open[i + b] ? 1 : 0);
    hex += nibble.toString(16);
  }
  return hex;
};

/** A Gate's opening at a Segment's placement — `position + orientation·(scale·p)`, like every other Asset point. */
export const placeGate = (opening: GateOpening, position: Vec3, orientation: Quat, scale: number): PlacedGate => {
  const place = (p: Vec3): Vec3 => addVec3(position, rotateVec3ByQuat(scaleVec3(p, scale), orientation));
  const axes = gateAxes(opening.tilt);
  return {
    origin: place(opening.origin),
    u: rotateVec3ByQuat(axes.u, orientation),
    v: rotateVec3ByQuat(axes.v, orientation),
    n: rotateVec3ByQuat(axes.n, orientation),
    cell: opening.cell * scale,
    cols: opening.cols,
    rows: opening.rows,
    open: decodeGateMask(opening.mask, opening.cols * opening.rows),
    center: place(opening.center),
  };
};

/** Whether a point on (or near) the Gate's plane lies in an open cell. */
export const gateOpenAt = (gate: PlacedGate, point: Vec3): boolean => {
  const d = subVec3(point, gate.origin);
  const col = Math.floor(dotVec3(d, gate.u) / gate.cell);
  const row = Math.floor(dotVec3(d, gate.v) / gate.cell);
  if (col < 0 || row < 0 || col >= gate.cols || row >= gate.rows) return false;
  return gate.open[row * gate.cols + col] === 1;
};

/**
 * Whether moving from `from` to `to` (one tick of a Character's capsule
 * centre) passes through the Gate (ADR 0068): the segment crosses the
 * opening's plane, and where it crosses is open. Either direction counts;
 * going around or over the Gate never does.
 */
export const passesThroughGate = (from: Vec3, to: Vec3, gate: PlacedGate): boolean => {
  const before = dotVec3(subVec3(from, gate.origin), gate.n);
  const after = dotVec3(subVec3(to, gate.origin), gate.n);
  if (before < 0 === after < 0) return false;
  const t = before / (before - after);
  return gateOpenAt(gate, addVec3(from, scaleVec3(subVec3(to, from), t)));
};
