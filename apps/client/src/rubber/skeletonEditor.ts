import type { BoneSpec } from "@dont-fall/shared";

/**
 * Live numbers for the skeleton, because the person who can see it is the one
 * who has to set them (the user, 2026-09-20: "nech mi to udělat mě přes
 * nějaký inputy, uvidím to real time a dám ti čísla pak").
 *
 * Every field writes straight into the working skeleton, so the wireframe and
 * the next knockout use it at once. Left and right are edited together — a
 * limb is one row, not two, and nothing here can put the two sides out of
 * step with each other.
 */

/** One editable row: a torso bone on its own, or a pair of limbs edited as one. */
/**
 * One number a row can set. `r` is the limb's tilt in degrees about the
 * body's forward axis — how far out to the side it hangs. BLIP's arms and
 * legs do stick out, and a `BoneSpec` otherwise describes a shape along its
 * own Y, so without this a skeleton shaped like BLIP cannot be written.
 */
export type Field = "x" | "y" | "w" | "h" | "d" | "r";

export interface BoneRow {
  label: string;
  /** The bones this row writes to — one, or a left/right pair. */
  names: readonly string[];
  /** Which numbers the row shows. A torso bone sits on the centre line, so it has no `x`. */
  fields: readonly Field[];
}

export const BONE_ROWS: readonly BoneRow[] = [
  { label: "head", names: ["head"], fields: ["y", "w", "h", "d"] },
  { label: "chest", names: ["chest"], fields: ["y", "w", "h", "d"] },
  { label: "pelvis", names: ["pelvis"], fields: ["y", "w", "h", "d"] },
  { label: "upper arm", names: ["upperArmL", "upperArmR"], fields: ["x", "y", "w", "h", "r"] },
  { label: "forearm", names: ["lowerArmL", "lowerArmR"], fields: ["x", "y", "w", "h", "r"] },
  { label: "thigh", names: ["upperLegL", "upperLegR"], fields: ["x", "y", "w", "h", "r"] },
  { label: "shin", names: ["lowerLegL", "lowerLegR"], fields: ["x", "y", "w", "h", "r"] },
];

/** What each field is called on a `BoneSpec`, and what it means on screen. */
export const FIELD_LABEL: Readonly<Record<Field, string>> = {
  x: "out",
  y: "up",
  w: "wide",
  h: "tall",
  d: "deep",
  r: "tilt°",
};

/** A limb's tilt, as a turn about the body's forward axis. Mirrored, so both sides lean outward. */
const tiltQuat = (degrees: number, side: number): { x: number; y: number; z: number; w: number } => {
  const half = ((degrees * Math.PI) / 180 / 2) * side;
  return { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) };
};

/** …and back out of one, for showing it. */
const tiltDegrees = (spec: BoneSpec): number => {
  const q = spec.restRotation;
  if (!q) return 0;
  const side = Math.sign(spec.restCenter.x || 1);
  return (2 * Math.atan2(q.z, q.w) * (180 / Math.PI)) / (side || 1);
};

export const readField = (spec: BoneSpec, field: Field): number => {
  if (field === "x") return Math.abs(spec.restCenter.x);
  if (field === "y") return spec.restCenter.y;
  if (field === "w") return spec.radius;
  if (field === "h") return spec.halfHeight;
  if (field === "r") return tiltDegrees(spec);
  return spec.depth ?? 0;
};

/**
 * Writes one field. `x` is the distance out from the middle, and the sign
 * stays whatever that bone already had, so the pair keeps its sides.
 */
export const writeField = (spec: BoneSpec, field: Field, value: number): BoneSpec => {
  switch (field) {
    case "r":
      return value === 0
        ? (({ restRotation: _dropped, ...upright }) => upright)(spec)
        : { ...spec, restRotation: tiltQuat(value, Math.sign(spec.restCenter.x || 1)) };
    case "x":
      return { ...spec, restCenter: { ...spec.restCenter, x: Math.sign(spec.restCenter.x || 1) * value } };
    case "y":
      return { ...spec, restCenter: { ...spec.restCenter, y: value } };
    case "w":
      return { ...spec, radius: value };
    case "h":
      return { ...spec, halfHeight: value };
    default:
      return { ...spec, depth: value };
  }
};

/**
 * The working skeleton, as TypeScript ready to paste back into
 * `blipSkeleton.ts`.
 *
 * `hinge` is printed too, and was not at first — a pasted table came back
 * with the spine, neck, elbows and knees silently turned into free ball
 * joints, which holds far less shape than the skeleton it replaced while
 * looking like it worked. Nothing in the editor can change a hinge, so it is
 * carried through untouched.
 */
export const asSource = (bones: readonly BoneSpec[]): string =>
  bones
    .map((b) => {
      const depth = b.depth === undefined ? "" : `, depth: ${+b.depth.toFixed(3)}`;
      const tilt =
        b.restRotation === undefined
          ? ""
          : `, restRotation: { x: 0, y: 0, z: ${+b.restRotation.z.toFixed(5)}, w: ${+b.restRotation.w.toFixed(5)} }`;
      const hinge =
        b.hinge === undefined
          ? ""
          : `, hinge: { axis: { x: ${b.hinge.axis.x}, y: ${b.hinge.axis.y}, z: ${b.hinge.axis.z} }, ` +
            `min: ${+b.hinge.min.toFixed(4)}, max: ${+b.hinge.max.toFixed(4)} }`;
      return (
        `  { name: ${JSON.stringify(b.name)}, parent: ${JSON.stringify(b.parent)}, ` +
        `restCenter: { x: ${+b.restCenter.x.toFixed(3)}, y: ${+b.restCenter.y.toFixed(3)}, z: 0 }, ` +
        `halfHeight: ${+b.halfHeight.toFixed(3)}, radius: ${+b.radius.toFixed(3)}${depth}, mass: ${b.mass}${tilt}${hinge} },`
      );
    })
    .join("\n");
