import RAPIER from "@dimforge/rapier3d-compat";
import {
  type BoneSnapshot,
  type BoneSpec,
  CAPSULE_BOTTOM_OFFSET,
  RAGDOLL_CONTACT_SKIN,
  RAGDOLL_LINEAR_DAMPING,
  RAGDOLL_SOLVER_ITERATIONS,
} from "@dont-fall/shared";
import * as THREE from "three";
import configV1 from "./authoredRig.json";
import configV2 from "./authoredRig_v2.json";
import configV3 from "./authoredRig_v3.json";

/**
 * The authored BLIP ragdoll, built straight from its own description (the
 * user's, 2026-09-20): a body on every rig pivot with its own collider shape
 * and offset, and the joints between them with their own anchors, axes and
 * limits.
 *
 * Deliberately **not** run through `BoneSpec` and the shared `Ragdoll`, which
 * was the first attempt and lost most of what makes this a rig: that model
 * anchors a joint halfway between two collider centres rather than at the
 * pivot it actually turns about, and it has one collider shape where this has
 * three. Nothing is converted here except units.
 *
 * The drawn body is posed by {@link syncBlipSkeletonFromRagdoll}, which needs
 * no bind offset because the bodies were created at the bone pivots.
 */

export interface BlipRagdoll {
  bodies: Map<string, RAPIER.RigidBody>;
  joints: RAPIER.ImpulseJoint[];
  /** Everything it owns, removed from the world. */
  dispose: () => void;
}

type Triple = [number, number, number];

/**
 * `angularDamping` is v2's: a per-bone say in how fast its spin bleeds away.
 * `convexHull` is v3's, and carries no offset — its points are already in the
 * bone's own frame, so there is nothing left to shift.
 */
export type ColliderSpec = { offset?: Triple; mass: number; angularDamping?: number } & (
  | { shape: "ball"; radius: number }
  | { shape: "capsule"; halfHeight: number; radius: number }
  | { shape: "cuboid"; halfExtents: Triple }
  | { shape: "convexHull"; points: Triple[] }
);

export interface BodySpec {
  bone: string;
  restWorld: { translation: Triple; rotation: [number, number, number, number] };
  collider: ColliderSpec;
}

export interface JointSpec {
  name: string;
  type: "spherical" | "revolute";
  bodyA: string;
  bodyB: string;
  anchorA: Triple;
  anchorB: Triple;
  axis?: Triple;
  /** Measured from the rest pose — the build shifts them by the hinge's own rest reading. */
  limits?: [number, number];
  /** v2's: a spring pulling the joint back toward `target`, so a limb has some tone of its own. */
  motor?: { target: number; stiffness: number; damping: number };
  contactsEnabled: boolean;
}

export interface AuthoredSpec {
  bodies: BodySpec[];
  joints: JointSpec[];
}

/**
 * The authored rigs that live as JSON. `v2` adds per-bone angular damping and
 * motors on the hinges — a limb with some tone of its own rather than a limb
 * that only falls; `v3` replaces the primitives with convex hulls.
 */
export const AUTHORED_SPECS = {
  v1: configV1 as unknown as AuthoredSpec,
  v2: configV2 as unknown as AuthoredSpec,
  v3: configV3 as unknown as AuthoredSpec,
} as const;

/** `v4` is not JSON: Blender-authored collider meshes, registered at load (see `blenderHulls.ts`). */
export type AuthoredVersion = keyof typeof AUTHORED_SPECS | "v4";

const SPECS = new Map<AuthoredVersion, AuthoredSpec>(Object.entries(AUTHORED_SPECS) as [AuthoredVersion, AuthoredSpec][]);

/** Adds (or replaces) a version built at runtime rather than read from JSON. */
export const registerAuthoredSpec = (version: AuthoredVersion, next: AuthoredSpec): void => {
  SPECS.set(version, next);
};

export const hasAuthoredSpec = (version: AuthoredVersion): boolean => SPECS.has(version);

const authoredSpec = (version: AuthoredVersion): AuthoredSpec => {
  const found = SPECS.get(version);
  if (!found) throw new Error(`authored rig "${version}" is not registered — was its collider model loaded?`);
  return found;
};

const spec = AUTHORED_SPECS.v1;

/** Every bone the authored rig drives, parent before child. */
export const BLIP_BONE_ORDER: readonly string[] = spec.bodies.map((body) => body.bone);

/** How it is placed in the world: the GLB's units scaled, and where its feet stand. */
export interface BlipRagdollPlacement {
  /** GLB units to the world's. */
  scale: number;
  /** Where the rig's own origin goes. */
  origin: THREE.Vector3;
  /** Which way the character faces (rad about +Y) — after a get-up it is no longer the spawn's. */
  yaw?: number;
}

const scaled = ([x, y, z]: Triple, by: number): { x: number; y: number; z: number } => ({
  x: x * by,
  y: y * by,
  z: z * by,
});

/** The bare shape, scaled — shared by the real build and the rest-overlap probe. */
const shapeDescFor = (c: ColliderSpec, scale: number): RAPIER.ColliderDesc | null => {
  if (c.shape === "convexHull") {
    const flat = new Float32Array(c.points.length * 3);
    for (const [i, [px, py, pz]] of c.points.entries()) {
      flat[i * 3] = px * scale;
      flat[i * 3 + 1] = py * scale;
      flat[i * 3 + 2] = pz * scale;
    }
    // Rapier answers null for points it cannot wrap. A bone with no
    // collider would fall through the world without a word about it.
    return RAPIER.ColliderDesc.convexHull(flat);
  }
  return c.shape === "ball"
    ? RAPIER.ColliderDesc.ball(c.radius * scale)
    : c.shape === "capsule"
      ? RAPIER.ColliderDesc.capsule(c.halfHeight * scale, c.radius * scale)
      : RAPIER.ColliderDesc.cuboid(c.halfExtents[0] * scale, c.halfExtents[1] * scale, c.halfExtents[2] * scale);
};

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Which bones already interpenetrate in the authored rest pose, found by
 * standing the colliders still in a throwaway world. Two bones the artist
 * modelled overlapping — v3's head hull reaches over both shoulders — can
 * never be pushed apart by the solver without deforming the rest pose, so a
 * contact between them only injects energy: measured, it threw the arms at
 * up to 13.6 u/s with nobody touching the doll. Those pairs are filtered out
 * of collision entirely (the standard ragdoll treatment of pairs born in
 * contact); everything that stands clear at rest still self-collides.
 *
 * The probe world is a throwaway with no gravity, and its bodies are
 * ordinary dynamics: contacts on the first step are evaluated at the rest
 * pose itself, before anything has moved, so what it reads is exactly the
 * authored overlap. (`Fixed` probe bodies would be tidier, but Rapier never
 * looks at a fixed-fixed pair — measured, not assumed.)
 */
const restPenetratingPairs = (chosen: AuthoredSpec, scale: number): Set<string> => {
  const probe = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const boneOf = new Map<number, string>();
  const colliders: RAPIER.Collider[] = [];
  for (const body of chosen.bodies) {
    const desc = shapeDescFor(body.collider, scale);
    if (!desc) continue;
    const [x, y, z] = body.restWorld.translation;
    const [qx, qy, qz, qw] = body.restWorld.rotation;
    const offset = scaled(body.collider.offset ?? [0, 0, 0], scale);
    const rigid = probe.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x * scale, y * scale, z * scale)
        .setRotation({ x: qx, y: qy, z: qz, w: qw }),
    );
    const collider = probe.createCollider(desc.setTranslation(offset.x, offset.y, offset.z), rigid);
    boneOf.set(collider.handle, body.bone);
    colliders.push(collider);
  }
  probe.step();
  // The real colliders wear a contact skin, so two surfaces closer than the
  // two skins put together are already "in contact" the moment they spawn —
  // measured, the feet standing 1.2 cm off the thighs were pushed hard
  // enough to drag both legs. The probe runs skinless and draws the line
  // where the skinned surfaces would meet.
  const touchingWithSkin = 2 * RAGDOLL_CONTACT_SKIN;
  const pairs = new Set<string>();
  for (const collider of colliders) {
    probe.contactPairsWith(collider, (other) => {
      let penetrates = false;
      probe.contactPair(collider, other, (manifold) => {
        for (let i = 0; i < manifold.numContacts(); i += 1) {
          if (manifold.contactDist(i) < touchingWithSkin) penetrates = true;
        }
      });
      if (penetrates) pairs.add(pairKey(boneOf.get(collider.handle)!, boneOf.get(other.handle)!));
    });
  }
  probe.free();
  return pairs;
};

const X_AXIS = new THREE.Vector3(1, 0, 0);

/**
 * What Rapier's revolute joint reads at the rest pose. Its hinge frame on
 * each body is the shortest-arc rotation taking local X to that body's axis,
 * and the joint angle is the twist of B's frame relative to A's about the
 * hinge — which at rest is not zero the moment the two bodies carry
 * different rest rotations. The spec's limits are written relative to the
 * rest pose (a knee bends 2.35 rad *from standing*), so the build shifts
 * them by this angle. Measured before the fix: the knees rested 0.21 rad
 * OUTSIDE their own limits and both shins were kicked at spawn.
 *
 * Shortest-arc is unique, so three's `setFromUnitVectors` agrees with
 * Rapier's internal frame — except for an axis exactly opposite X, where
 * both pick an arbitrary perpendicular and may disagree. No authored axis is
 * anywhere near −X; if one ever is, this needs the frames read back from
 * Rapier instead.
 */
const restHingeAngle = (
  qA: THREE.Quaternion,
  qB: THREE.Quaternion,
  axisA: THREE.Vector3,
  axisB: THREE.Vector3,
): number => {
  const frameA = new THREE.Quaternion().setFromUnitVectors(X_AXIS, axisA);
  const frameB = new THREE.Quaternion().setFromUnitVectors(X_AXIS, axisB);
  // (qA·frameA)⁻¹ · (qB·frameB) — both map X to the world hinge axis at
  // rest, so what is left is a pure twist about X.
  const rel = frameA.premultiply(qA).invert().multiply(frameB.premultiply(qB));
  if (rel.w < 0) rel.set(-rel.x, -rel.y, -rel.z, -rel.w);
  return 2 * Math.atan2(rel.x, rel.w);
};

export const createBlipRagdoll = (
  world: RAPIER.World,
  where: BlipRagdollPlacement,
  version: AuthoredVersion = "v1",
): BlipRagdoll => {
  const bodies = new Map<string, RAPIER.RigidBody>();
  const { scale, origin } = where;
  const chosen = authoredSpec(version);

  // The whole rest pose is turned to face `yaw` — a character that got up
  // where it fell no longer faces the way it spawned, and a doll built
  // facing +Z under a turned mesh would snap the mesh around on first sync.
  const facing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), where.yaw ?? 0);
  const restRotationOf = new Map(
    chosen.bodies.map((body) => {
      const [qx, qy, qz, qw] = body.restWorld.rotation;
      return [body.bone, new THREE.Quaternion(qx, qy, qz, qw).premultiply(facing)] as const;
    }),
  );
  const restTranslationOf = new Map(
    chosen.bodies.map((body) => {
      const [x, y, z] = body.restWorld.translation;
      const at = new THREE.Vector3(x * scale, y * scale, z * scale).applyQuaternion(facing).add(origin);
      return [body.bone, at] as const;
    }),
  );

  // One membership bit per bone (15 fit in Rapier's 16), with the filter
  // dropping every partner it was authored interpenetrating.
  const touching = restPenetratingPairs(chosen, scale);
  const bitOf = new Map(chosen.bodies.map((body, i) => [body.bone, 1 << i]));

  for (const body of chosen.bodies) {
    const at = restTranslationOf.get(body.bone)!;
    const spin = restRotationOf.get(body.bone)!;
    const rigid = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(at.x, at.y, at.z)
        .setRotation({ x: spin.x, y: spin.y, z: spin.z, w: spin.w })
        // The shared Ragdoll's numbers (knockdown.ts): 0.55 here bled 42% of
        // every velocity per second — the doll fell as if through honey and
        // froze mid-heap. Angular damping stays the spec's own.
        .setLinearDamping(RAGDOLL_LINEAR_DAMPING)
        .setAngularDamping(body.collider.angularDamping ?? 1.1)
        // The shared Ragdoll's answer to a jointed body taking a large shove.
        .setAdditionalSolverIterations(RAGDOLL_SOLVER_ITERATIONS)
        .setCanSleep(false),
    );

    const c = body.collider;
    const desc = shapeDescFor(c, scale);
    if (!desc) {
      console.warn(`authored rig: no hull for "${body.bone}"`);
      continue;
    }

    let filter = 0xffff;
    for (const other of chosen.bodies) {
      if (other.bone !== body.bone && touching.has(pairKey(body.bone, other.bone))) {
        filter &= ~bitOf.get(other.bone)!;
      }
    }

    // A hull's points already say where it sits; everything else is offset.
    const offset = scaled(c.offset ?? [0, 0, 0], scale);
    world.createCollider(
      desc
        .setTranslation(offset.x, offset.y, offset.z)
        .setMass(c.mass)
        .setFriction(0.7)
        .setRestitution(0.05)
        .setContactSkin(RAGDOLL_CONTACT_SKIN)
        .setCollisionGroups(((bitOf.get(body.bone)! << 16) | filter) >>> 0),
      rigid,
    );
    bodies.set(body.bone, rigid);
  }

  const joints: RAPIER.ImpulseJoint[] = [];

  /**
   * Hard stops for the ball joints, which this Rapier binding cannot limit
   * directly (the wasm call for a spherical joint takes anchors and nothing
   * else — checked, not assumed). Without them an arm orbits the shoulder
   * through the torso and a hand winds up on the wrist without end ("to
   * nesmí jít", the user, 2026-09-20).
   *
   * Each ball joint gets two rope joints, both length-0 at rest so they can
   * never kick at spawn:
   * - one from the parent to a point ON the child's bone axis — a hard cone
   *   around the rest direction. A point on the axis never moves under
   *   twist, so this is a pure swing stop.
   * - one to a point OFF the axis — a point at radius r moves 2·r·sin(θ/2)
   *   under ANY rotation θ, swing and twist alike, so this caps the total
   *   turn at swing + a twist allowance. Rotation cannot be decomposed by a
   *   distance constraint, which is why the twist cap is a budget, not an
   *   exact angle — the wind-up it exists to stop was many full turns.
   */
  const SWING_LIMIT: Record<string, number> = {
    pelvis_body: 0.35,
    shoulder_L: 1.4,
    shoulder_R: 1.4,
    wrist_L: 0.9,
    wrist_R: 0.9,
    hip_L: 1.2,
    hip_R: 1.2,
    ankle_L: 0.7,
    ankle_R: 0.7,
  };
  const TWIST_BUDGET = 0.6;
  /** How far from the pivot the rope holds on (GLB units) — a longer lever asks less of the solver. */
  const ROPE_LEVER = 0.4;

  const ballStops = (
    joint: JointSpec,
    a: RAPIER.RigidBody,
    b: RAPIER.RigidBody,
    anchorB: { x: number; y: number; z: number },
  ): RAPIER.ImpulseJoint[] => {
    const qA = restRotationOf.get(joint.bodyA)!;
    const qB = restRotationOf.get(joint.bodyB)!;
    const tA = restTranslationOf.get(joint.bodyA)!;
    const tB = restTranslationOf.get(joint.bodyB)!;
    const lever = ROPE_LEVER * scale;
    const swing = SWING_LIMIT[joint.name] ?? 1.0;

    const rope = (childLocal: THREE.Vector3, maxAngle: number): RAPIER.ImpulseJoint => {
      // The point's rest position, world, then said in the parent's frame —
      // so at rest both rope ends coincide and the rope reads length 0.
      const restWorld = childLocal.clone().applyQuaternion(qB).add(tB);
      const parentLocal = restWorld.sub(tA).applyQuaternion(qA.clone().invert());
      const length = 2 * lever * Math.sin(Math.min(Math.PI / 2, maxAngle / 2));
      const made = world.createImpulseJoint(
        RAPIER.JointData.rope(length, parentLocal, childLocal),
        a,
        b,
        true,
      );
      made.setContactsEnabled(joint.contactsEnabled);
      return made;
    };

    const pivot = new THREE.Vector3(anchorB.x, anchorB.y, anchorB.z);
    return [
      rope(pivot.clone().add(new THREE.Vector3(0, lever, 0)), swing),
      rope(pivot.clone().add(new THREE.Vector3(lever, 0, 0)), swing + TWIST_BUDGET),
    ];
  };
  for (const joint of chosen.joints) {
    const a = bodies.get(joint.bodyA);
    const b = bodies.get(joint.bodyB);
    if (!a || !b) continue;
    const anchorA = scaled(joint.anchorA, scale);
    const anchorB = scaled(joint.anchorB, scale);

    let data: RAPIER.JointData;
    // How far the built hinge reads from zero at the rest pose; the spec's
    // rest-relative limits and motor targets are shifted by it.
    let restAngle = 0;
    if (joint.type === "spherical") {
      data = RAPIER.JointData.spherical(anchorA, anchorB);
      joints.push(...ballStops(joint, a, b, anchorB));
    } else {
      // One hinge axis in the WORLD, written in bodyA's frame by the spec —
      // and expressed per body, because the two bodies' rest rotations
      // differ. `JointData.revolute`'s single axis is read in BOTH local
      // frames, which is only the same hinge when both bodies rest at
      // identity (the trap ragdollSkeleton.ts documents); built that way,
      // the elbows were misaligned 33.5° at rest and snapped on spawn.
      const qA = restRotationOf.get(joint.bodyA)!;
      const qB = restRotationOf.get(joint.bodyB)!;
      const axisA = new THREE.Vector3(joint.axis?.[0] ?? 1, joint.axis?.[1] ?? 0, joint.axis?.[2] ?? 0).normalize();
      const worldAxis = axisA.clone().applyQuaternion(qA);
      const axisB = worldAxis.clone().applyQuaternion(qB.clone().invert()).normalize();
      data = RAPIER.JointData.revoluteWithAxes(anchorA, anchorB, axisA, axisB);
      restAngle = restHingeAngle(qA, qB, axisA, axisB);
    }

    const made = world.createImpulseJoint(data, a, b, true);
    made.setContactsEnabled(joint.contactsEnabled);
    // A spherical joint comes back from this build as a class carrying no
    // `setLimits` at all, so the guard is real and not defensive dressing.
    if (made instanceof RAPIER.RevoluteImpulseJoint) {
      if (joint.limits) made.setLimits(joint.limits[0] + restAngle, joint.limits[1] + restAngle);
      // A motor is v2's way of giving a limb tone: it is pulled back toward
      // an angle rather than only hanging from its joint.
      if (joint.motor) {
        made.configureMotorPosition(joint.motor.target + restAngle, joint.motor.stiffness, joint.motor.damping);
      }
    }
    joints.push(made);
  }

  return {
    bodies,
    joints,
    dispose: () => {
      for (const body of bodies.values()) world.removeRigidBody(body);
      bodies.clear();
      joints.length = 0;
    },
  };
};

/** Each rig's bones by THREE name, built once — GLTFLoader strips the dots BLIP's limb bones carry. */
const bonesByRoot = new WeakMap<THREE.Object3D, Map<string, THREE.Bone>>();
const bonesOf = (root: THREE.Object3D): Map<string, THREE.Bone> => {
  let map = bonesByRoot.get(root);
  if (!map) {
    map = new Map<string, THREE.Bone>();
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) map!.set(o.name, o as THREE.Bone);
    });
    bonesByRoot.set(root, map);
  }
  return map;
};

const UNIT_SCALE = new THREE.Vector3(1, 1, 1);
const syncTarget = new THREE.Matrix4();
const syncLocal = new THREE.Matrix4();
const syncPosition = new THREE.Vector3();
const syncRotation = new THREE.Quaternion();
const syncScale = new THREE.Vector3();

/**
 * Drives the GLB armature from Rapier, after `world.step()`. The bodies were
 * created at the bone pivots, so there is no bind offset to undo.
 *
 * Each bone's local transform is solved against its parent's REAL
 * `matrixWorld` — always, and the bones are written parent before child so
 * that matrix is the parent's *new* place. The real matrix matters because it
 * carries the model's uniform scale: inverting it hands back a local offset
 * already divided by that scale, which composing through the parent then
 * restores, landing the bone exactly on its body. An earlier version solved
 * some bones against the physics target matrix instead (unit scale) — those
 * bones were drawn at 58% of their offset from their parent, which is what
 * squashed the torso into the pelvis. The 1/scale the decompose reports is
 * discarded on purpose: a ragdoll owns where a bone is and which way it
 * faces, never how big it is.
 */
export const syncBlipSkeletonFromRagdoll = (root: THREE.Object3D, ragdoll: BlipRagdoll): void => {
  const bones = bonesOf(root);
  // Ancestors physics does not drive (the GLB's `root` bone, the armature)
  // must be where the renderer last put them before locals solve against them.
  root.updateMatrixWorld(true);

  // `bodies` keeps the spec's insertion order, which is parent before child.
  for (const [name, body] of ragdoll.bodies) {
    const bone = bones.get(name.replace(/\./g, "")) ?? bones.get(name);
    if (!bone?.parent) continue;
    const t = body.translation();
    const r = body.rotation();
    syncTarget.compose(syncPosition.set(t.x, t.y, t.z), syncRotation.set(r.x, r.y, r.z, r.w), UNIT_SCALE);
    syncLocal.copy(bone.parent.matrixWorld).invert().multiply(syncTarget);
    syncLocal.decompose(syncPosition, syncRotation, syncScale);
    bone.position.copy(syncPosition);
    bone.quaternion.copy(syncRotation);
    bone.updateMatrix();
    bone.updateMatrixWorld(true);
  }
};

/**
 * The same rig as shapes the wireframe can draw — for looking at only, never
 * for building anything. The physics is built from the spec itself (see
 * {@link createBlipRagdoll}); this exists because the viewer speaks
 * `BoneSpec`, and drawing the game's skeleton while the authored one was
 * selected made it look like nothing had happened.
 *
 * A collider's offset is in its bone's own frame, so it is turned by the rest
 * rotation before being added to the pivot. The result is in ragdoll space —
 * measured from the Capsule centre, as every other skeleton here is — because
 * the viewer adds that centre back on, and handing it floor-measured numbers
 * drew the whole rig `CAPSULE_BOTTOM_OFFSET` too high.
 *
 * `originY` is the placement's own: the mesh is lowered so its lowest vertex
 * sits on the floor, and the physics goes with it (see `main.ts`), so the
 * drawn rest pose has to as well or it floats 26 mm above both. `yaw` turns
 * the drawn rest pose the way the placement turns the built one.
 */
export const authoredDrawBones = (
  scale: number,
  version: AuthoredVersion = "v1",
  originY = 0,
  yaw = 0,
): BoneSpec[] => {
  const facing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const turn = new THREE.Quaternion();
  const offset = new THREE.Vector3();
  const centre = new THREE.Vector3();
  return authoredSpec(version).bodies.map((body) => {
    const [x, y, z] = body.restWorld.translation;
    const [qx, qy, qz, qw] = body.restWorld.rotation;
    turn.set(qx, qy, qz, qw).premultiply(facing);
    centre.set(x * scale, y * scale, z * scale).applyQuaternion(facing);
    const c = body.collider;
    const at = c.offset ?? [0, 0, 0];
    offset.set(at[0] * scale, at[1] * scale, at[2] * scale).applyQuaternion(turn);

    const shaped =
      c.shape === "convexHull"
        ? {
            shape: "hull" as const,
            // Drawn from the same points the collider is built from.
            hullPoints: c.points.map(([px, py, pz]) => ({ x: px * scale, y: py * scale, z: pz * scale })),
            radius: 0,
            halfHeight: 0,
          }
        : c.shape === "capsule"
        ? { shape: "capsule" as const, radius: c.radius * scale, halfHeight: c.halfHeight * scale }
        : c.shape === "ball"
          ? {
              shape: "box" as const,
              radius: c.radius * scale,
              halfHeight: c.radius * scale,
              depth: c.radius * scale,
              roundness: 1,
            }
          : {
              shape: "box" as const,
              radius: c.halfExtents[0] * scale,
              halfHeight: c.halfExtents[1] * scale,
              depth: c.halfExtents[2] * scale,
              roundness: 0.1,
            };

    return {
      name: body.bone,
      parent: null,
      mass: c.mass,
      restCenter: {
        x: centre.x + offset.x,
        y: centre.y + originY + offset.y - CAPSULE_BOTTOM_OFFSET,
        z: centre.z + offset.z,
      },
      restRotation: { x: turn.x, y: turn.y, z: turn.z, w: turn.w },
      ...shaped,
    };
  });
};

/** Where every body is right now, in {@link BLIP_BONE_ORDER}, for drawing it mid-fall. */
export const readAuthoredPose = (
  ragdoll: BlipRagdoll,
  scale: number,
  version: AuthoredVersion = "v1",
): BoneSnapshot[] => {
  const turn = new THREE.Quaternion();
  const offset = new THREE.Vector3();
  return authoredSpec(version).bodies.map((body) => {
    const rigid = ragdoll.bodies.get(body.bone)!;
    const t = rigid.translation();
    const r = rigid.rotation();
    turn.set(r.x, r.y, r.z, r.w);
    const c = body.collider;
    const at = c.offset ?? [0, 0, 0];
    offset.set(at[0] * scale, at[1] * scale, at[2] * scale).applyQuaternion(turn);
    return {
      position: { x: t.x + offset.x, y: t.y + offset.y, z: t.z + offset.z },
      rotation: { x: r.x, y: r.y, z: r.z, w: r.w },
    };
  });
};
