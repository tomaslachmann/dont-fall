import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  addJoint,
  draftFromBones,
  boneEnd,
  fitLength,
  type RigDraft,
  removeJoint,
  rotateSubtree,
  shapeCentre,
  shapeOffsetFor,
  toBoneSpecs,
} from "./rigTool.js";

/** A shoulder with a forearm hanging off it, both out on positive x. */
const arm = (): RigDraft => [
  { name: "chest", parent: null, at: new THREE.Vector3(0, 0, 0), roundness: 1, width: 0.5, depth: 0.35, length: 0.4, shapeOffset: { x: 0, y: 0, z: 0 }, mass: 4 },
  { name: "upperArmL", parent: "chest", at: new THREE.Vector3(0.6, 0.2, 0), roundness: 1, width: 0.12, depth: 0.12, length: 0.15, shapeOffset: { x: 0, y: 0.15, z: 0 }, mass: 0.7 },
  { name: "lowerArmL", parent: "upperArmL", at: new THREE.Vector3(0.9, 0.2, 0), roundness: 1, width: 0.1, depth: 0.1, length: 0.125, shapeOffset: { x: 0, y: 0.125, z: 0 }, mass: 0.6 },
];

const at = (draft: RigDraft, name: string): THREE.Vector3 => draft.find((j) => j.name === name)!.at;
const spec = (draft: RigDraft, name: string) => toBoneSpecs(draft).find((b) => b.name === name)!;

/** Which way a bone points, from the turn its spec carries. */
const direction = (draft: RigDraft, name: string): THREE.Vector3 => {
  const r = spec(draft, name).restRotation!;
  return new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
};

describe("a bone starts at its joint and reaches its own length", () => {
  it("points at the child and sits one half-length out from the joint", () => {
    const upper = spec(arm(), "upperArmL");
    // The joint is at 0.6 and its half-length is 0.15.
    expect(upper.restCenter.x).toBeCloseTo(0.75, 6);
    expect(direction(arm(), "upperArmL").x).toBeCloseTo(1, 6);
  });

  it("gives a tip the same treatment, along the way its parent pointed", () => {
    const lower = spec(arm(), "lowerArmL");
    expect(lower.restCenter.x).toBeCloseTo(0.9 + 0.125, 6);
    expect(direction(arm(), "lowerArmL").x).toBeCloseTo(1, 6);
  });

  // The control that used to be dead on every bone but a tip.
  it("lets length be set on a bone that has a child, and moves nothing else", () => {
    const before = spec(arm(), "upperArmL");
    const stretched = arm().map((j) => (j.name === "upperArmL" ? { ...j, length: 0.4 } : j));
    const upper = spec(stretched, "upperArmL");
    // Longer, and in exactly the same place: length is size, not position.
    expect(upper.halfHeight).toBeGreaterThan(before.halfHeight);
    expect(upper.restCenter).toEqual(before.restCenter);
    // Its child stayed where it was: a bone's reach is not the joint spacing.
    expect(at(stretched, "lowerArmL").x).toBeCloseTo(0.9, 6);
  });

  it("means the same half-length whatever the roundness is", () => {
    for (const roundness of [0, 0.4, 1]) {
      const b = spec(
        arm().map((j) => (j.name === "upperArmL" ? { ...j, roundness, length: 0.3 } : j)),
        "upperArmL",
      );
      expect(b.halfHeight).toBeCloseTo(0.3, 6);
    }
  });

  // What the user caught: a torso joint sits at the *bottom* of its segment
  // in the rig, so a shape that only ever grew upward from it sat half a
  // segment too high over the part it covers.
  it("sits a bone exactly on its joint at no offset", () => {
    const centred = spec(arm(), "chest");
    expect(centred.restCenter.x).toBeCloseTo(0, 6);
    expect(centred.restCenter.y).toBeCloseTo(0, 6);
  });

  it("hangs it along the bone, or back behind the joint, as the offset says", () => {
    const along = new THREE.Vector3(0.6, 0.2, 0).normalize().multiplyScalar(0.4);
    const hung = spec(
      arm().map((j) => (j.name === "chest" ? { ...j, shapeOffset: { x: 0, y: 0.4, z: 0 } } : j)),
      "chest",
    );
    expect(hung.restCenter.x).toBeCloseTo(along.x, 6);
    expect(hung.restCenter.y).toBeCloseTo(along.y, 6);

    const behind = spec(
      arm().map((j) => (j.name === "upperArmL" ? { ...j, shapeOffset: { x: 0, y: -0.15, z: 0 } } : j)),
      "upperArmL",
    );
    expect(behind.restCenter.x).toBeCloseTo(0.6 - 0.15, 6);
  });

  it("fits back to the joint spacing when asked", () => {
    expect(fitLength(arm(), "upperArmL")).toBeCloseTo(0.3 / 2, 6);
  });

  it("reaches where the armature draws it, offset included", () => {
    expect(boneEnd(arm(), "upperArmL")!.x).toBeCloseTo(0.6 + 0.15 * 2, 6);
    // Centred on its joint, so it reaches only one half-length past it.
    const along = new THREE.Vector3(0.6, 0.2, 0).normalize().multiplyScalar(0.4);
    expect(boneEnd(arm(), "chest")!.y).toBeCloseTo(along.y, 6);
  });

  it("builds every bone as a rounded box, so all three axes are its own", () => {
    const chest = spec(arm(), "chest");
    expect(chest.shape).toBe("box");
    expect(chest.radius).toBeCloseTo(0.5, 6);
    expect(chest.depth).toBeCloseTo(0.35, 6);
    expect(chest.roundness).toBe(1);
  });

  // The thing a capsule could never do: it has one radius, so depth was dead.
  it("keeps width and depth apart even on a limb", () => {
    const flat = arm().map((j) => (j.name === "upperArmL" ? { ...j, width: 0.2, depth: 0.05 } : j));
    const upper = spec(flat, "upperArmL");
    expect(upper.radius).toBeCloseTo(0.2, 6);
    expect(upper.depth).toBeCloseTo(0.05, 6);
  });

  it("carries roundness through, from crate to fully round", () => {
    for (const roundness of [0, 0.5, 1]) {
      const shaped = arm().map((j) => (j.name === "upperArmL" ? { ...j, roundness } : j));
      expect(spec(shaped, "upperArmL").roundness).toBe(roundness);
    }
  });

  it("lets a bone be deeper than it is wide — which one number and a ratio could not", () => {
    const deep = arm().map((j) => (j.name === "chest" ? { ...j, width: 0.3, depth: 0.6 } : j));
    const chest = spec(deep, "chest");
    expect(chest.radius).toBeCloseTo(0.3, 6);
    expect(chest.depth).toBeCloseTo(0.6, 6);
    expect(chest.depth!).toBeGreaterThan(chest.radius);
  });
});

describe("a joint and its shape are two different things", () => {
  // The user, 2026-09-20: moving a joint used to be the only way to move
  // anything, so the collider could never be placed on its own.
  it("moves the shape without moving the joint", () => {
    const before = arm();
    const moved = before.map((j) =>
      j.name === "upperArmL" ? { ...j, shapeOffset: { x: 0.05, y: 0.3, z: -0.04 } } : j,
    );
    expect(at(moved, "upperArmL").toArray()).toEqual(at(before, "upperArmL").toArray());
    expect(spec(moved, "upperArmL").restCenter).not.toEqual(spec(before, "upperArmL").restCenter);
  });

  it("carries the shape along when the joint itself moves", () => {
    const before = arm();
    const moved = before.map((j) =>
      j.name === "upperArmL" ? { ...j, at: at(before, "upperArmL").clone().add(new THREE.Vector3(0, 0.4, 0)) } : j,
    );
    // It stays the same distance from its joint — not in the same *direction*,
    // because the offset is in the bone's own frame and moving a joint away
    // from its child turns the bone, which turns the shape with it. That is
    // the point of keeping the offset local rather than in the world.
    const reach = (d: RigDraft): number => shapeCentre(d, "upperArmL")!.distanceTo(at(d, "upperArmL"));
    expect(reach(moved)).toBeCloseTo(reach(before), 6);
  });

  it("reads a shape back to exactly where it was put", () => {
    const draft = arm();
    const target = new THREE.Vector3(0.9, 0.55, -0.2);
    const offset = shapeOffsetFor(draft, "upperArmL", target);
    const moved = draft.map((j) => (j.name === "upperArmL" ? { ...j, shapeOffset: offset } : j));
    expect(shapeCentre(moved, "upperArmL")!.distanceTo(target)).toBeLessThan(1e-6);
  });

  it("offsets in the bone's own frame, so a turned bone turns its shape with it", () => {
    const offset = { x: 0, y: 0, z: 0.3 };
    const straight = arm().map((j) => (j.name === "upperArmL" ? { ...j, shapeOffset: offset } : j));
    const turned = rotateSubtree(straight, "chest", new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));
    const a = shapeCentre(straight, "upperArmL")!.clone().sub(at(straight, "upperArmL"));
    const b = shapeCentre(turned, "upperArmL")!.clone().sub(at(turned, "upperArmL"));
    // Same offset in the bone's frame, a different one in the world's.
    expect(a.length()).toBeCloseTo(b.length(), 6);
    expect(a.distanceTo(b)).toBeGreaterThan(0.1);
  });
});

describe("a hull keeps its points through the tool", () => {
  // What the user caught: an authored rig read into the tool came back with
  // `wide 0, tall 0, deep 0` and drew shapes of no size — visible as nothing
  // but their joints.
  const hullBones = [
    {
      name: "pelvis",
      parent: null,
      mass: 2,
      shape: "hull" as const,
      radius: 0,
      halfHeight: 0,
      restCenter: { x: 0, y: 0.5, z: 0 },
      restRotation: { x: 0, y: 0.3826834, z: 0, w: 0.9238795 },
      hullPoints: [
        { x: -0.5, y: -0.2, z: -0.4 },
        { x: 0.5, y: -0.2, z: -0.4 },
        { x: 0.5, y: 0.3, z: 0.4 },
        { x: -0.5, y: 0.3, z: 0.4 },
        { x: 0, y: 0.3, z: -0.4 },
      ],
    },
  ];

  it("measures a hull's numbers off its own points instead of showing zeroes", () => {
    const [joint] = draftFromBones(hullBones);
    expect(joint!.width).toBeCloseTo(0.5, 6);
    expect(joint!.length).toBeCloseTo(0.25, 6);
    expect(joint!.depth).toBeCloseTo(0.4, 6);
  });

  it("hands the same points back out, still a hull", () => {
    const back = toBoneSpecs(draftFromBones(hullBones))[0]!;
    expect(back.shape).toBe("hull");
    expect(back.hullPoints).toEqual(hullBones[0]!.hullPoints);
  });

  it("keeps the turn it was authored with, rather than re-aiming it at a child", () => {
    const back = toBoneSpecs(draftFromBones(hullBones))[0]!;
    expect(back.restRotation).toEqual(hullBones[0]!.restRotation);
  });
});

describe("which child a bone points at", () => {
  it("follows the one that carries on straightest, not the first in the list", () => {
    // A spine with a head above and an arm out to the side: the torso must
    // keep pointing up the spine however the joints happen to be ordered.
    const torso: RigDraft = [
      { name: "chest", parent: null, at: new THREE.Vector3(0, 0, 0), roundness: 1, width: 0.4, depth: 0.3, length: 0.3, shapeOffset: { x: 0, y: 0, z: 0 }, mass: 4 },
      { name: "upperArmL", parent: "chest", at: new THREE.Vector3(0.6, 0.05, 0), roundness: 1, width: 0.1, depth: 0.1, length: 0.15, shapeOffset: { x: 0, y: 0.15, z: 0 }, mass: 0.7 },
      { name: "head", parent: "chest", at: new THREE.Vector3(0, 0.6, 0), roundness: 1, width: 0.3, depth: 0.3, length: 0.2, shapeOffset: { x: 0, y: 0, z: 0 }, mass: 1.4 },
    ];
    // The arm comes first in the list; the head is the straighter continuation.
    const r = toBoneSpecs(torso).find((b) => b.name === "chest")!.restRotation!;
    const points = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
    expect(points.y).toBeCloseTo(1, 6);
  });
});

describe("rotateSubtree — turning a joint turns what hangs off it", () => {
  const quarterAboutZ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);

  it("swings the child around the joint, keeping its distance", () => {
    const before = arm();
    const reach = at(before, "lowerArmL").distanceTo(at(before, "upperArmL"));
    const after = rotateSubtree(before, "upperArmL", quarterAboutZ);
    const moved = at(after, "lowerArmL");
    expect(moved.distanceTo(at(after, "upperArmL"))).toBeCloseTo(reach, 6);
    // A quarter turn about +Z takes a child that was out on +x to straight up.
    expect(moved.x).toBeCloseTo(0.6, 6);
    expect(moved.y).toBeCloseTo(0.2 + reach, 6);
  });

  it("leaves the joint itself where it is — a rotation is not a move", () => {
    const after = rotateSubtree(arm(), "upperArmL", quarterAboutZ);
    expect(at(after, "upperArmL").toArray()).toEqual([0.6, 0.2, 0]);
    expect(at(after, "chest").toArray()).toEqual([0, 0, 0]);
  });

  it("turns the bone that hangs from it, because the child moved", () => {
    const after = rotateSubtree(arm(), "upperArmL", quarterAboutZ);
    expect(direction(after, "upperArmL").y).toBeCloseTo(1, 6);
  });

  it("aims a tip instead, since it has nothing below to swing", () => {
    const after = rotateSubtree(arm(), "lowerArmL", quarterAboutZ);
    expect(at(after, "lowerArmL").toArray()).toEqual([0.9, 0.2, 0]);
    expect(after.find((j) => j.name === "lowerArmL")!.aim).toBeDefined();
    // It pointed out along +x and now points up.
    expect(direction(after, "lowerArmL").y).toBeCloseTo(1, 6);
  });

  it("accumulates one turn onto the next", () => {
    const eighth = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 4);
    const twice = rotateSubtree(rotateSubtree(arm(), "lowerArmL", eighth), "lowerArmL", eighth);
    expect(direction(twice, "lowerArmL").y).toBeCloseTo(1, 6);
  });

  it("changes nothing when nothing is turned", () => {
    const after = rotateSubtree(arm(), "upperArmL", new THREE.Quaternion());
    expect(at(after, "lowerArmL").toArray()).toEqual([0.9, 0.2, 0]);
  });

  it("carries the whole chain when the root is turned", () => {
    const after = rotateSubtree(arm(), "chest", quarterAboutZ);
    expect(at(after, "upperArmL").y).toBeCloseTo(0.6, 6);
    expect(at(after, "lowerArmL").y).toBeCloseTo(0.9, 6);
  });
});

describe("growing and pruning the chain", () => {
  it("hangs a new joint off the one it was added to", () => {
    const grown = addJoint(arm(), "chest", "spine2");
    expect(grown).toHaveLength(4);
    expect(toBoneSpecs(grown).map((b) => b.name)).toContain("spine2");
  });

  it("hands a dropped joint's children back to its own parent", () => {
    const pruned = removeJoint(arm(), "upperArmL");
    expect(pruned.map((j) => j.name)).not.toContain("upperArmL");
    expect(pruned.find((j) => j.name === "lowerArmL")!.parent).toBe("chest");
  });

  it("keeps the root, whatever is asked", () => {
    expect(removeJoint(arm(), "chest")).toHaveLength(3);
  });
});
