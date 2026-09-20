import { type BoneSpec, RAGDOLL_BONES } from "@dont-fall/shared";
import * as THREE from "three";

/**
 * The ragdoll as a thing you build, not a table you type (the user's ask,
 * 2026-09-20: "udělej mi nástroj, se kterým můžu opravdu udělat ten rig").
 *
 * What is edited here is **joints**, because that is what a rig is: a joint is
 * a point where rotation happens, and a bone is the span from one joint to
 * the next. Drag a joint and every bone touching it changes shape and
 * direction on its own — which is the part the number editor could never do,
 * since it asked for a collider's centre and half-extents and left the
 * relationship between them to be typed in by hand.
 *
 * A bone's collider is therefore derived, never authored:
 *
 * - a bone with a child spans from its own joint to that child's;
 * - a bone without one (a forearm, a shin, the head) spans its own
 *   {@link RigJoint.length} along the direction it inherits from its parent;
 * - `thickness` is the radius across it, and `flatten` squashes it front to
 *   back, which is what makes a torso an egg rather than a sausage.
 *
 * Only the shapes and the joint positions belong to this file. Which bone
 * hinges where, how far, and how heavy it is stay with {@link RAGDOLL_BONES},
 * because the rig cannot say any of them.
 */

export interface RigJoint {
  /** This joint's own name. Free — a skeleton may have three spine joints or none. */
  name: string;
  /** The joint it hangs from, or null for the root. */
  parent: string | null;
  /** Where the rotation happens, in ragdoll space (from the Capsule centre, `L` on positive x). */
  at: THREE.Vector3;
  /**
   * How far the bone is rounded off, 0 (a crate) to 1 (rounded to the limit
   * of its thinnest axis).
   *
   * There is no shape to pick any more, because picking one took control
   * away: Rapier's capsule has a single radius, so choosing it made `deep`
   * dead and `wide` drive both axes at once, and nothing flattened could be
   * built at all. Every bone is now a rounded box — at equal width and depth
   * that *is* a capsule, flattened it is a slab, all three equal and fully
   * round it is a ball — so the three axes and this are all that is needed.
   */
  roundness: number;
  /**
   * Half-extent across the bone, left to right.
   *
   * Its own number, not a share of anything: a single `thickness` with a
   * `flatten` ratio beside it could never make a bone deeper than it is wide,
   * which is a shape a body has (the user, 2026-09-20).
   */
  width: number;
  /** Half-extent through it, front to back. Read by a box; the round shapes are as deep as they are wide and use {@link width}. */
  depth: number;
  /**
   * Half-extent **along** the bone, from its joint outward. Always its own
   * number, for every bone and every shape.
   *
   * It used to be read only for a tip, with everything else taking its length
   * from the gap to the child joint — so the slider was dead on most bones
   * and nobody could tell which. The joints now say where a bone starts and
   * which way it points; how far it reaches is authored. {@link fitLength}
   * snaps it back to the joint spacing when that is what is wanted.
   */
  length: number;
  /**
   * Where the shape sits relative to its joint, in the bone's **own** frame:
   * `y` runs along the bone, `x` across it and `z` through it.
   *
   * Three axes and not one number along the bone, because a joint and a
   * collider are two different things: the joint is where the rotation
   * happens and the shape is what the body is made of, and the shape has to
   * be placeable anywhere around it (the user, 2026-09-20 — "proč nejde
   * posunovat jen skeleton a ty jointy"). The authored rigs say the same
   * thing with their own `collider.offset`.
   *
   * Moving a joint still carries its shape along, because the shape is
   * attached to the bone. Moving the shape moves only the shape.
   */
  shapeOffset: { x: number; y: number; z: number };
  /** How heavy it is. Rapier needs one per body and the rig cannot say it. */
  mass: number;
  /**
   * Which rig node this joint poses, if any. A skeleton may carry joints the
   * drawn body has no bone for — a second spine segment, a rib — and those
   * simply take part in the physics and move nothing.
   */
  drives?: string;
  /** A hinge, or nothing for a free ball joint. Inherited from the game's skeleton where a name matches. */
  hinge?: BoneSpec["hinge"];
  /**
   * The points this bone's shape is wrapped around, when it is a hull rather
   * than a box. Carried through untouched: `width`, `tall` and `deep` say
   * nothing about a hull, and dropping the points on the way in left the
   * authored rigs drawing shapes of size zero — visible as nothing but their
   * joints.
   */
  hullPoints?: readonly { x: number; y: number; z: number }[];
  /**
   * The turn this bone was authored with, kept verbatim. Without it a
   * skeleton read back from bones would be re-aimed at whichever child it
   * has, which is right for a rig being built here and wrong for one that
   * already says how every bone is turned.
   */
  fixedRotation?: { x: number; y: number; z: number; w: number };
  /**
   * Where the bone points when nothing hangs off it to point at — a turn
   * applied to the direction it would otherwise inherit from its parent.
   *
   * Only a tip needs one. Rotating a joint that *has* children swings those
   * children around it instead ({@link rotateSubtree}), which is what a rig
   * does and what makes a shoulder turn a whole arm; there is nothing left
   * for an aim to say. A tip has no children to move, so its turn is kept
   * here.
   */
  aim?: { x: number; y: number; z: number; w: number };
}

export type RigDraft = RigJoint[];

/**
 * The chain to seed from: BLIP's own bones, in the order they hang. More than
 * the eleven the game's ragdoll has — the crest is two more joints, and a
 * spine could be split further here without anything else having to know.
 */
const SEED_CHAIN: readonly { name: string; parent: string | null; node: string; torso?: true }[] = [
  { name: "pelvis", parent: null, node: "pelvis", torso: true },
  { name: "chest", parent: "pelvis", node: "body", torso: true },
  { name: "head", parent: "chest", node: "head", torso: true },
  { name: "upperArmL", parent: "chest", node: "upper_armL" },
  { name: "lowerArmL", parent: "upperArmL", node: "forearmL" },
  { name: "upperArmR", parent: "chest", node: "upper_armR" },
  { name: "lowerArmR", parent: "upperArmR", node: "forearmR" },
  { name: "upperLegL", parent: "pelvis", node: "thighL" },
  { name: "lowerLegL", parent: "upperLegL", node: "shinL" },
  { name: "upperLegR", parent: "pelvis", node: "thighR" },
  { name: "lowerLegR", parent: "upperLegR", node: "shinR" },
];

/** Where a bone with no child in the chain still ends, so it has a length to start from. */
const TIP_OF: Readonly<Record<string, string>> = {
  head: "crest01",
  lowerArmL: "handL",
  lowerArmR: "handR",
  lowerLegL: "footL",
  lowerLegR: "footR",
};

/** A first draft straight off the rig in the GLB: its joints, where the artist put them. */
export const draftFromRig = (model: THREE.Object3D, capsuleCentreY: number): RigDraft => {
  const world = (name: string): THREE.Vector3 | null => {
    const node = model.getObjectByName(name);
    return node ? node.getWorldPosition(new THREE.Vector3()) : null;
  };
  const known = new Map(RAGDOLL_BONES.map((b) => [b.name, b]));
  return SEED_CHAIN.map((link) => {
    const found = world(link.node);
    const at = (found ?? new THREE.Vector3(0, capsuleCentreY, 0)).clone();
    at.y -= capsuleCentreY;
    // The ragdoll puts `L` on positive x; BLIP names its sides its own way.
    if (link.name.endsWith("L")) at.x = Math.abs(at.x);
    else if (link.name.endsWith("R")) at.x = -Math.abs(at.x);

    const tip = TIP_OF[link.name] ? world(TIP_OF[link.name]!) : null;
    const span = tip && found ? Math.max(0.05, tip.clone().sub(found).length()) : 0.4;
    const game = known.get(link.name);
    return {
      name: link.name,
      parent: link.parent,
      at,
      roundness: 1,
      width: link.torso ? 0.5 : 0.12,
      depth: link.torso ? 0.38 : 0.12,
      length: span / 2,
      // A torso sits over its joint; a limb hangs along from it.
      shapeOffset: { x: 0, y: link.torso ? 0 : span / 2, z: 0 },
      mass: game?.mass ?? 1,
      drives: link.node,
      hinge: game?.hinge,
    };
  });
};

/**
 * A draft for a skeleton that was not read off the rig — the game's, or an
 * authored one — so every skeleton can be edited by the same tool.
 *
 * Each joint is put at its bone's own centre with {@link RigJoint.offset} 0,
 * which makes the round trip exact: {@link toBoneSpecs} puts the shape back
 * where it was. A capsule's caps are folded into the length, since a draft
 * builds boxes and a box has none.
 */
export const draftFromBones = (bones: readonly BoneSpec[]): RigDraft => {
  return bones.map((spec) => {
    const capsule = (spec.shape ?? "capsule") === "capsule";
    // A hull carries no radius or half-height of its own, so its numbers are
    // measured off the points. Without this the panel showed zeroes and the
    // shapes came out with no size at all.
    const hull = spec.shape === "hull" && spec.hullPoints?.length ? spec.hullPoints : null;
    const half = hull
      ? (axis: "x" | "y" | "z"): number =>
          Math.max(0.01, (Math.max(...hull.map((p) => p[axis])) - Math.min(...hull.map((p) => p[axis]))) / 2)
      : null;
    return {
      name: spec.name,
      parent: spec.parent,
      at: new THREE.Vector3(spec.restCenter.x, spec.restCenter.y, spec.restCenter.z),
      width: half ? half("x") : spec.radius,
      depth: half ? half("z") : (spec.depth ?? spec.radius),
      length: half ? half("y") : capsule ? spec.halfHeight + spec.radius : spec.halfHeight,
      shapeOffset: { x: 0, y: 0, z: 0 },
      roundness: spec.roundness ?? 1,
      mass: spec.mass,
      hinge: spec.hinge,
      drives: spec.name,
      ...(spec.hullPoints ? { hullPoints: spec.hullPoints } : {}),
      ...(spec.restRotation ? { fixedRotation: spec.restRotation } : {}),
      ...(spec.restRotation
        ? {
            aim: (() => {
              const turn = new THREE.Quaternion(
                spec.restRotation.x,
                spec.restRotation.y,
                spec.restRotation.z,
                spec.restRotation.w,
              );
              // Kept as the tip aim, which is the only place a draft carries a
              // turn of its own; a bone with children takes its direction from
              // where they are.
              return { x: turn.x, y: turn.y, z: turn.z, w: turn.w };
            })(),
          }
        : {}),
    };
  });
};

/** A new joint hanging off `parent`, halfway to wherever it points. */
export const addJoint = (draft: RigDraft, parentName: string | null, name: string): RigDraft => {
  const parent = draft.find((j) => j.name === parentName);
  const at = parent ? parent.at.clone().add(new THREE.Vector3(0, 0.15, 0)) : new THREE.Vector3(0, 0, 0);
  return [
    ...draft,
    {
      name,
      parent: parentName,
      at,
      roundness: 1,
      width: 0.12,
      depth: 0.12,
      length: 0.2,
      shapeOffset: { x: 0, y: 0.2, z: 0 },
      mass: 0.5,
    },
  ];
};

/** Drops a joint, and hands whatever hung off it back to its own parent. */
export const removeJoint = (draft: RigDraft, name: string): RigDraft => {
  const going = draft.find((j) => j.name === name);
  if (!going || going.parent === null) return draft;
  return draft
    .filter((j) => j.name !== name)
    .map((j) => (j.parent === name ? { ...j, parent: going.parent } : j));
};

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Which way a bone points: at its child if it has one, otherwise on the way
 * its parent pointed, turned by however the tip has been aimed. Always a unit
 * vector — how far it reaches is {@link RigJoint.length}, not this.
 */
const boneDirection = (draft: RigDraft, by: Map<string, RigJoint>, joint: RigJoint): THREE.Vector3 => {
  const parent = joint.parent ? by.get(joint.parent) : undefined;
  // The way this joint was already heading — up, for a root.
  const incoming = (parent ? joint.at.clone().sub(parent.at) : UP.clone()).normalize();
  const children = draft.filter((other) => other.parent === joint.name);
  // Whichever child carries on straightest. A chest has three — the head and
  // two arms — and taking the first in the list would let a reordering or a
  // newly added joint turn the torso to point into an arm.
  const child = children.reduce<RigJoint | undefined>((best, candidate) => {
    if (!best) return candidate;
    const score = (j: RigJoint): number => j.at.clone().sub(joint.at).normalize().dot(incoming);
    return score(candidate) > score(best) ? candidate : best;
  }, undefined);

  const out = new THREE.Vector3();
  if (child) out.copy(child.at).sub(joint.at);
  else out.copy(incoming);
  if (out.lengthSq() === 0) out.copy(UP);
  out.normalize();
  if (!child && joint.aim) {
    out.applyQuaternion(new THREE.Quaternion(joint.aim.x, joint.aim.y, joint.aim.z, joint.aim.w));
  }
  return out;
};

/** Where a bone reaches to — its joint plus twice its half-length, for drawing it. */
export const boneEnd = (draft: RigDraft, name: string): THREE.Vector3 | null => {
  const by = new Map(draft.map((j) => [j.name, j]));
  const joint = by.get(name);
  if (!joint) return null;
  // Where the shape actually reaches: its own centre plus one half-length.
  const direction = boneDirection(draft, by, joint);
  const turn = new THREE.Quaternion().setFromUnitVectors(UP, direction);
  const centre = new THREE.Vector3(joint.shapeOffset.x, joint.shapeOffset.y, joint.shapeOffset.z)
    .applyQuaternion(turn)
    .add(joint.at);
  return centre.addScaledVector(direction, joint.length);
};

/** The half-length that makes a bone exactly span the gap to its child. */
export const fitLength = (draft: RigDraft, name: string): number => {
  const joint = draft.find((j) => j.name === name);
  const child = draft.find((other) => other.parent === name);
  if (!joint || !child) return joint?.length ?? 0.2;
  return Math.max(0.02, child.at.distanceTo(joint.at) / 2);
};

/** Where a bone's shape sits in the world, for putting a handle on it. */
export const shapeCentre = (draft: RigDraft, name: string): THREE.Vector3 | null => {
  const by = new Map(draft.map((j) => [j.name, j]));
  const joint = by.get(name);
  if (!joint) return null;
  const turn = new THREE.Quaternion().setFromUnitVectors(UP, boneDirection(draft, by, joint));
  return new THREE.Vector3(joint.shapeOffset.x, joint.shapeOffset.y, joint.shapeOffset.z)
    .applyQuaternion(turn)
    .add(joint.at);
};

/** The shape offset that would put a bone's centre at `world`, in the bone's own frame. */
export const shapeOffsetFor = (draft: RigDraft, name: string, world: THREE.Vector3): { x: number; y: number; z: number } => {
  const by = new Map(draft.map((j) => [j.name, j]));
  const joint = by.get(name)!;
  const turn = new THREE.Quaternion().setFromUnitVectors(UP, boneDirection(draft, by, joint));
  const local = world.clone().sub(joint.at).applyQuaternion(turn.invert());
  return { x: local.x, y: local.y, z: local.z };
};

/**
 * The colliders a draft describes. Each bone is centred halfway along itself
 * and turned to lie along it, so nothing about the shape has to be kept in
 * step by hand.
 */
export const toBoneSpecs = (draft: RigDraft): BoneSpec[] => {
  const by = new Map(draft.map((joint) => [joint.name, joint]));
  const direction = new THREE.Vector3();
  const middle = new THREE.Vector3();
  const turn = new THREE.Quaternion();

  return draft.map((joint) => {
    direction.copy(boneDirection(draft, by, joint));
    turn.setFromUnitVectors(UP, direction);
    // A bone that was authored with its own turn keeps it: re-aiming one at
    // whichever child it happens to have would twist a finished rig.
    if (joint.fixedRotation) {
      turn.set(joint.fixedRotation.x, joint.fixedRotation.y, joint.fixedRotation.z, joint.fixedRotation.w);
    }
    // The shape's offset is written in the bone's own frame, so it is turned
    // with the bone before it is added to the joint.
    middle
      .set(joint.shapeOffset.x, joint.shapeOffset.y, joint.shapeOffset.z)
      .applyQuaternion(turn)
      .add(joint.at);

    const base = {
      name: joint.name,
      parent: joint.parent,
      mass: joint.mass,
      // A bone starts at its joint and reaches `length` each way from its own
      // middle, so the middle sits one `length` along from the joint.
      restCenter: { x: middle.x, y: middle.y, z: middle.z },
      radius: joint.width,
      restRotation: { x: turn.x, y: turn.y, z: turn.z, w: turn.w },
      ...(joint.hinge ? { hinge: joint.hinge } : {}),
    };
    // A hull is handed straight back: its points are its shape, and no box
    // would be the same thing.
    if (joint.hullPoints?.length) {
      return { ...base, shape: "hull", hullPoints: joint.hullPoints, halfHeight: joint.length };
    }
    // Otherwise a rounded box: three half-extents that mean exactly what they
    // say, and a roundness that carries it from crate to capsule to ball.
    return {
      ...base,
      shape: "box",
      halfHeight: joint.length,
      depth: joint.depth,
      roundness: joint.roundness,
    };
  });
};

/** Every joint hanging below `name`, however deep. */
const descendants = (draft: RigDraft, name: string): RigJoint[] => {
  const found: RigJoint[] = [];
  const walk = (parent: string): void => {
    for (const joint of draft) {
      if (joint.parent !== parent) continue;
      found.push(joint);
      walk(joint.name);
    }
  };
  walk(name);
  return found;
};

/**
 * Turns a joint the way a rig turns one: everything below it swings around
 * it, keeping its distance. A tip, with nothing below, keeps the turn as its
 * own {@link RigJoint.aim} instead.
 */
export const rotateSubtree = (draft: RigDraft, name: string, delta: THREE.Quaternion): RigDraft => {
  const pivot = draft.find((j) => j.name === name);
  if (!pivot) return draft;
  const below = new Set(descendants(draft, name).map((j) => j.name));
  if (below.size === 0) {
    const aim = new THREE.Quaternion(pivot.aim?.x ?? 0, pivot.aim?.y ?? 0, pivot.aim?.z ?? 0, pivot.aim?.w ?? 1);
    aim.premultiply(delta);
    return draft.map((j) =>
      j.name === name ? { ...j, aim: { x: aim.x, y: aim.y, z: aim.z, w: aim.w } } : j,
    );
  }
  return draft.map((joint) => {
    if (!below.has(joint.name)) return joint;
    const at = joint.at.clone().sub(pivot.at).applyQuaternion(delta).add(pivot.at);
    return { ...joint, at };
  });
};

/** The draft as TypeScript, ready to keep. */
export const draftToSource = (draft: RigDraft): string =>
  draft
    .map(
      (j) =>
        `  { name: ${JSON.stringify(j.name)}, parent: ${JSON.stringify(j.parent)}, ` +
        `at: { x: ${+j.at.x.toFixed(3)}, y: ${+j.at.y.toFixed(3)}, z: ${+j.at.z.toFixed(3)} }, ` +
        `width: ${+j.width.toFixed(3)}, depth: ${+j.depth.toFixed(3)}, roundness: ${+j.roundness.toFixed(3)}, ` +
        `shapeOffset: { x: ${+j.shapeOffset.x.toFixed(3)}, y: ${+j.shapeOffset.y.toFixed(3)}, ` +
        `z: ${+j.shapeOffset.z.toFixed(3)} }, ` +
        `length: ${+j.length.toFixed(3)}, mass: ${j.mass}` +
        (j.aim
          ? `, aim: { x: ${+j.aim.x.toFixed(4)}, y: ${+j.aim.y.toFixed(4)}, z: ${+j.aim.z.toFixed(4)}, w: ${+j.aim.w.toFixed(4)} }`
          : "") +
        `${j.drives ? `, drives: ${JSON.stringify(j.drives)}` : ""} },`,
    )
    .join("\n");
