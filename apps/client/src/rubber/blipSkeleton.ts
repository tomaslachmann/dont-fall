import { type BoneSpec, RAGDOLL_BONES, RAGDOLL_ELBOW_MAX, RAGDOLL_KNEE_MIN, RAGDOLL_NECK_LIMIT, RAGDOLL_SPINE_LIMIT } from "@dont-fall/shared";

/**
 * A ragdoll shaped like BLIP, for the demo to try against the one the game
 * actually uses. Nothing in `packages/shared` is changed by this file: it is a
 * second skeleton handed to the same `Ragdoll` class, and the Match still
 * builds the default one.
 *
 * It exists because the game's skeleton was authored for M1's capsule
 * placeholder and never re-measured when BLIP replaced it (ADR 0046/0071).
 *
 * Every number below is measured off the real mesh, per bone, by asking which
 * bone each vertex is mostly weighted to and taking the box its own skin
 * fills — in ragdoll space (from the Capsule centre, `L` on positive x):
 *
 * | bone      | centre  | half width | half height | half depth |
 * |-----------|---------|-----------|-------------|------------|
 * | pelvis    | y −0.43 | 0.47      | 0.17        | 0.37       |
 * | body      | y −0.03 | 0.59      | 0.23        | 0.44       |
 * | head      | y  0.53 | 0.66      | 0.33        | 0.44       |
 * | upper arm | x ±0.69 | 0.12      | 0.16        | 0.13       |
 * | forearm   | x ±0.79 | 0.14      | 0.14        | 0.14       |
 * | thigh     | x ±0.29 | 0.14      | 0.08        | 0.21       |
 * | shin      | x ±0.28 | 0.14      | 0.05        | 0.16       |
 *
 * against a game ragdoll whose chest is a capsule of radius 0.18 centred at
 * y +0.24. It is in the wrong place *and* a third of the width, which is why
 * a physics knockout can put an arm somewhere that is visually inside the
 * body: in that place there is no torso to collide with.
 *
 * Two earlier cuts of this file had it wrong in ways worth recording. The
 * first read the torso as 0.85 wide, from a slab of vertices taken at the
 * *game* chest's height and with the arms left in — 44% too wide. The second
 * sized an oval bone with a capsule's convention, where the radius adds to
 * the length, so a torso 0.85 wide came out 2.1 tall, taller than the whole
 * Character. Both were believable enough to draw conclusions from, and both
 * were only caught by drawing the bones on screen.
 *
 * The limbs keep almost no length of their own: BLIP's are stubs, so they
 * measure as near-spheres, and that is what they are built as. Every bone
 * keeps an identity rest rotation, because `BoneSpec` describes a shape along
 * its own Y and `Ragdoll.activate` starts every bone unrotated — BLIP's arms
 * really do stick out sideways, so that part is still unexpressed.
 */

const spine = RAGDOLL_BONES.find((b) => b.name === "chest")!.hinge!.axis;

/** A hinge around the body's left-right axis — the same one the game's skeleton uses. */
const sideways = (min: number, max: number): NonNullable<BoneSpec["hinge"]> => ({ axis: spine, min, max });

/** Half-width of the body's own skin, measured per bone off the real mesh. */
export const BLIP_BODY_HALF_WIDTH = 0.54;
/** Half-thickness of the same, front to back. The bean is 0.59 by 0.44 — oval, but far less so than its silhouette suggests. */
export const BLIP_BODY_HALF_DEPTH = 0.44;

export const BLIP_RAGDOLL_BONES: readonly BoneSpec[] = [
  // The user's own numbers, 2026-09-20, tuned live in `rubber.html` against
  // the see-through model, starting from what `skeletonFromRig` measured. The
  // hinges are the game skeleton's, restored: the editor cannot change one,
  // and an early `COPY SKELETON` dropped them on the way out.
  { name: "pelvis", parent: null, restCenter: { x: 0, y: -0.38, z: 0 }, halfHeight: 0.169, radius: 0.42, depth: 0.372, mass: 3 },
  {
    name: "chest",
    parent: "pelvis",
    restCenter: { x: 0, y: 0.02, z: 0 },
    halfHeight: 0.5,
    radius: 0.54,
    depth: 0.44,
    mass: 4,
    hinge: sideways(-RAGDOLL_SPINE_LIMIT, RAGDOLL_SPINE_LIMIT),
  },
  {
    name: "head",
    parent: "chest",
    restCenter: { x: 0, y: 0.49, z: 0 },
    halfHeight: 0.329,
    radius: 0.45,
    depth: 0.39,
    mass: 1.4,
    hinge: sideways(-RAGDOLL_NECK_LIMIT, RAGDOLL_NECK_LIMIT),
  },

  { name: "upperArmL", parent: "chest", restCenter: { x: 0.57, y: 0.24, z: 0 }, halfHeight: 0.022, radius: 0.136, mass: 0.7 },
  { name: "lowerArmL", parent: "upperArmL", restCenter: { x: 0.66, y: -0.09, z: 0 }, halfHeight: 0.01, radius: 0.142, mass: 0.6, hinge: sideways(0, RAGDOLL_ELBOW_MAX) },
  { name: "upperArmR", parent: "chest", restCenter: { x: -0.57, y: 0.24, z: 0 }, halfHeight: 0.023, radius: 0.134, mass: 0.7 },
  { name: "lowerArmR", parent: "upperArmR", restCenter: { x: -0.66, y: -0.09, z: 0 }, halfHeight: 0.01, radius: 0.142, mass: 0.6, hinge: sideways(0, RAGDOLL_ELBOW_MAX) },

  { name: "upperLegL", parent: "pelvis", restCenter: { x: 0.291, y: -0.519, z: 0 }, halfHeight: 0.01, radius: 0.15, mass: 1.6 },
  { name: "lowerLegL", parent: "upperLegL", restCenter: { x: 0.29, y: -0.646, z: 0 }, halfHeight: 0.01, radius: 0.13, mass: 1.2, hinge: sideways(RAGDOLL_KNEE_MIN, 0) },
  { name: "upperLegR", parent: "pelvis", restCenter: { x: -0.291, y: -0.519, z: 0 }, halfHeight: 0.01, radius: 0.15, mass: 1.6 },
  { name: "lowerLegR", parent: "upperLegR", restCenter: { x: -0.29, y: -0.646, z: 0 }, halfHeight: 0.01, radius: 0.13, mass: 1.2, hinge: sideways(RAGDOLL_KNEE_MIN, 0) },
];

/** Which skeleton the demo is knocking down. */
export const SKELETONS = {
  game: { label: "the game's", bones: RAGDOLL_BONES },
  blip: { label: "BLIP-shaped", bones: BLIP_RAGDOLL_BONES },
} as const;

/** The ones on offer. `authored*` are built from `authoredRig*.json` (and v4 from the Blender collider export) at load, so they are not in the table above. */
export type SkeletonName = keyof typeof SKELETONS | "authored" | "authoredV2" | "authoredV3" | "authoredV4";
