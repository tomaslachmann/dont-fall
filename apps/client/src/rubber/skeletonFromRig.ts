import { type BoneSpec, CAPSULE_BOTTOM_OFFSET, RAGDOLL_BONES } from "@dont-fall/shared";
import * as THREE from "three";

/**
 * Builds a ragdoll skeleton out of the rig that is already in `BLIP.glb`
 * (the user's question, 2026-09-20: "vždyť BLIP.glb má v sobě už rig").
 *
 * It does, and it is the right source — but a glTF rig is an *animation*
 * skeleton: bones, their rest transforms, and which vertices they move. None
 * of what a physics body needs is in the file, because the format has nowhere
 * to put it: no collider, no mass, no joint, no limit. So a ragdoll is always
 * a second skeleton. What it should never be is a *hand-written* one, which
 * is what the first cut of `blipSkeleton.ts` was — numbers measured once by a
 * throwaway script and pasted in, and wrong twice before they were right.
 *
 * Here the same measurement runs against the real asset every time the demo
 * loads: each bone's shape is the box its **own skin** fills, found by asking
 * every vertex which bone moves it most. Re-export the model with a fatter
 * belly and the ragdoll follows it, with nothing to retype.
 *
 * A bone is a **segment**, not a blob (the user, 2026-09-20: "jsou to
 * rotátory ty koule a ty jsou spojené kostmi, což my vůbec neděláme"). A rig
 * bone is a joint — a point with an orientation — and the limb is the span
 * from that joint to the next one down the chain. So each limb here is a
 * capsule running from its own joint to its child's, turned to match, and the
 * impulse joint sits at the head where the rotation happens. The first cut
 * centred a ball on each joint and took its size from the skin's bounding
 * box, which is why limbs came out as spheres of length 0.01 and why the arms
 * needed a hand-set rest rotation to point anywhere: the direction was in the
 * rig all along.
 *
 * The torso keeps its skin-box shape: pelvis, body and head are not segments
 * of anything, they are the egg, and an egg is what they should be.
 *
 * What still has to be decided by hand, because the rig cannot say it: which
 * rig bone stands in for which ragdoll bone, what hinges where and how far,
 * and how heavy each piece is. Those come from {@link RAGDOLL_BONES}, whose
 * joint layout this keeps.
 */

/** Which rig node each ragdoll bone takes its shape from. Sides are measured, never read off the name (ADR 0071). */
const RIG_STEM: Readonly<Record<string, string>> = {
  pelvis: "pelvis",
  chest: "body",
  head: "head",
  upperArm: "upper_arm",
  lowerArm: "forearm",
  upperLeg: "thigh",
  lowerLeg: "shin",
};

/**
 * Which rig node is each bone's **tail** — the joint at its far end. A limb is
 * the span between the two.
 */
const RIG_TAIL: Readonly<Record<string, string>> = {
  upperArm: "forearm",
  lowerArm: "hand",
  upperLeg: "shin",
  lowerLeg: "foot",
};

/** The bones that carry the body, and so are built as flattened eggs rather than capsules. */
const OVAL = new Set(["pelvis", "chest", "head"]);

/** A capsule is built along its own Y, so a segment's turn is measured from there. */
const UP = new THREE.Vector3(0, 1, 0);

/**
 * The rig names its sides from BLIP's point of view and the ragdoll puts `L`
 * on positive x, so a limb read off the rig may need mirroring across the
 * body's middle: x flips, and with it the turn's y and z parts.
 */
const mirroredTurn = (
  turn: THREE.Quaternion,
  side: "L" | "R",
  measuredX: number,
): { x: number; y: number; z: number; w: number } => {
  const wanted = side === "L" ? 1 : -1;
  const flip = Math.sign(measuredX || wanted) !== wanted;
  return flip
    ? { x: turn.x, y: -turn.y, z: -turn.z, w: turn.w }
    : { x: turn.x, y: turn.y, z: turn.z, w: turn.w };
};

const splitSide = (name: string): { stem: string; side: "L" | "R" } | null => {
  const side = name.endsWith("L") ? "L" : name.endsWith("R") ? "R" : null;
  return side ? { stem: name.slice(0, -1), side } : null;
};

/** The box each rig bone's own skin fills, in the model's space. */
const skinBoxes = (root: THREE.Object3D): Map<string, THREE.Box3> => {
  const boxes = new Map<string, THREE.Box3>();
  const point = new THREE.Vector3();
  root.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const position = mesh.geometry.attributes.position;
    const skinIndex = mesh.geometry.attributes.skinIndex;
    const skinWeight = mesh.geometry.attributes.skinWeight;
    if (!position || !skinIndex || !skinWeight) return;
    for (let i = 0; i < position.count; i += 1) {
      let owner = 0;
      let heaviest = -1;
      for (const c of [0, 1, 2, 3]) {
        const weight = skinWeight.getComponent(i, c);
        if (weight > heaviest) {
          heaviest = weight;
          owner = skinIndex.getComponent(i, c);
        }
      }
      const bone = mesh.skeleton.bones[owner];
      if (!bone) continue;
      point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      const box = boxes.get(bone.name) ?? new THREE.Box3().makeEmpty();
      boxes.set(bone.name, box.expandByPoint(point));
    }
  });
  return boxes;
};

/**
 * `model` is the loaded scene, already scaled to the Character's height. The
 * result is in ragdoll space: measured from the Capsule centre, with `L` on
 * positive x, as {@link RAGDOLL_BONES} has it.
 */
export const skeletonFromRig = (model: THREE.Object3D): BoneSpec[] => {
  /** Where a rig joint sits, in ragdoll space. Null for a name the rig does not have. */
  const jointAt = (name: string): THREE.Vector3 | null => {
    const node = model.getObjectByName(name);
    return node ? node.getWorldPosition(new THREE.Vector3()) : null;
  };
  const keep = model.position.clone();
  // Measured from the Capsule centre, whatever the caller parked the model at.
  model.position.set(0, -new THREE.Box3().setFromObject(model).min.y + model.position.y - CAPSULE_BOTTOM_OFFSET, 0);
  model.updateMatrixWorld(true);
  const boxes = skinBoxes(model);

  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const built = RAGDOLL_BONES.map((spec) => {
    const split = splitSide(spec.name);
    const stem = RIG_STEM[split ? split.stem : spec.name];
    // The rig names its sides from its own point of view, so both are read and
    // the one on positive x is the one the ragdoll calls `L`.
    const candidates = split
      ? (["L", "R"] as const).map((s) => boxes.get(`${stem}${s}`)).filter((b): b is THREE.Box3 => b !== undefined)
      : [boxes.get(stem ?? "")].filter((b): b is THREE.Box3 => b !== undefined);
    if (candidates.length === 0) return spec;
    const box = split
      ? candidates.sort((a, b) => b.getCenter(new THREE.Vector3()).x - a.getCenter(new THREE.Vector3()).x)[
          split.side === "L" ? 0 : candidates.length - 1
        ]!
      : candidates[0]!;
    box.getSize(size);
    box.getCenter(centre);
    const x = split ? Math.abs(centre.x) * (split.side === "L" ? 1 : -1) : 0;
    if (OVAL.has(spec.name)) {
      return {
        ...spec,
        restCenter: { x, y: centre.y, z: 0 },
        radius: size.x / 2,
        halfHeight: size.y / 2,
        depth: size.z / 2,
      };
    }

    // A limb runs from its own joint to its child's. Both ends come from the
    // rig, so the direction an arm hangs in is read, never guessed.
    const side = split!.side;
    const head = jointAt(`${stem}${side}`);
    const tail = jointAt(`${RIG_TAIL[split!.stem] ?? ""}${side}`);
    const { depth: _round, ...capsule } = spec;
    if (!head || !tail) return { ...capsule, restCenter: { x, y: centre.y, z: 0 } };

    const along = tail.clone().sub(head);
    const length = along.length();
    // Thickness across the limb, from the two skin dimensions that are not its length.
    const radius = Math.max(0.03, Math.min(size.x, size.y, size.z) / 2);
    const middle = head.clone().addScaledVector(along, 0.5);
    const turn = new THREE.Quaternion().setFromUnitVectors(UP, along.clone().normalize());
    return {
      ...capsule,
      // Mirrored onto the ragdoll's own convention, where `L` is positive x.
      restCenter: { x: side === "L" ? Math.abs(middle.x) : -Math.abs(middle.x), y: middle.y, z: middle.z },
      radius,
      halfHeight: Math.max(0.01, length / 2 - radius),
      restRotation: mirroredTurn(turn, side, middle.x),
    };
  });

  // Put the model back where the caller had it.
  model.position.copy(keep);
  model.updateMatrixWorld(true);
  return built;
};
