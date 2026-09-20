import RAPIER from "@dimforge/rapier3d-compat";
import { CAPSULE_BOTTOM_OFFSET, initPhysics, RAGDOLL_CONTACT_SKIN } from "@dont-fall/shared";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { ConvexHull } from "three/addons/math/ConvexHull.js";
import { publicUrl } from "../lib/publicUrl.js";
import { boneOf, CHARACTER_VISUAL_HEIGHT } from "../render/characterModel.js";

/**
 * The dev-only bake behind `pnpm bake:ragdoll` (`.scratch/physical-ragdoll`,
 * ticket 01): everything `AuthoredRagdoll` needs, resolved to literal sim-unit
 * data once, here, where three.js is at hand — per-body hinge axes,
 * rest-shifted limits, rope-stop cone/twist anchors, the zero-g rest-overlap
 * probe and the get-up clips' first frames. The recipe is the rubber bench's,
 * proven on `rubber.html` (2026-09-20); the shared simulation then builds
 * joints from the baked numbers and does no frame math of its own.
 *
 * Inputs: `public/models/BLIP.glb` (the served rig — rest skeleton and the
 * `GetUp_*` clips) and `public/models/blip_with_coliders.glb` (the Blender
 * collider export: fifteen `COL_<bone>` meshes at the rest pose).
 */

/** What the bake script polls for. */
declare global {
  interface Window {
    dontFallRagdollBake?: { ready: boolean; error?: string; spec?: unknown };
  }
}

type Triple = [number, number, number];
type Quad = [number, number, number, number];

interface BaseBody {
  bone: string;
  restWorld: { translation: Triple; rotation: Quad };
  mass: number;
  angularDamping?: number;
}

interface BaseJoint {
  name: string;
  type: "spherical" | "revolute";
  bodyA: string;
  bodyB: string;
  anchorA: Triple;
  anchorB: Triple;
  axis?: Triple;
  limits?: [number, number];
  motor?: { target: number; stiffness: number; damping: number };
}

/**
 * The authored skeleton — the rubber bench's `authoredRig_v3.json` minus its
 * hull points (the hulls come from the Blender export below): a body on every
 * rig pivot in the GLB's own units, masses, the neck's tone, and the joints
 * with their authored anchors, axes and rest-relative limits. Wire order,
 * parent before child.
 */
const BASE_BODIES: readonly BaseBody[] = [
  { bone: "pelvis", restWorld: { translation: [0, 0.68, 0], rotation: [0, 0, 0, 1] }, mass: 2.1 },
  { bone: "body", restWorld: { translation: [0, 1.18, 0], rotation: [0, 0, 0, 1] }, mass: 3.2 },
  { bone: "head", restWorld: { translation: [0, 1.98, 0], rotation: [0, 0, 0, 1] }, mass: 2.0, angularDamping: 2.4 },
  { bone: "upper_arm.L", restWorld: { translation: [-0.7, 1.98, 0], rotation: [0.0260281, 0.0381421, 0.8251226, 0.5630634] }, mass: 0.4 },
  { bone: "forearm.L", restWorld: { translation: [-1.252778, 1.763582, 0.055], rotation: [0.0264189, 0.083597, 0.9498458, 0.3001774] }, mass: 0.28 },
  { bone: "hand.L", restWorld: { translation: [-1.430946, 1.509848, 0.11], rotation: [0.0133078, 0.0412622, 0.9508311, 0.3066603] }, mass: 0.2 },
  { bone: "upper_arm.R", restWorld: { translation: [0.7, 1.98, 0], rotation: [-0.0260281, 0.0381421, 0.8251226, -0.5630634] }, mass: 0.4 },
  { bone: "forearm.R", restWorld: { translation: [1.252778, 1.763582, 0.055], rotation: [-0.0264189, 0.083597, 0.9498458, -0.3001774] }, mass: 0.28 },
  { bone: "hand.R", restWorld: { translation: [1.430946, 1.509848, 0.11], rotation: [-0.0133078, 0.0412622, 0.9508311, -0.3066603] }, mass: 0.2 },
  { bone: "thigh.L", restWorld: { translation: [-0.485, 0.74, 0], rotation: [0.0006321, 0.0708755, 0.9974452, 0.0089049] }, mass: 0.55 },
  { bone: "shin.L", restWorld: { translation: [-0.49, 0.46, 0.04], rotation: [-0.0025693, -0.082281, 0.9961205, 0.0310981] }, mass: 0.4 },
  { bone: "foot.L", restWorld: { translation: [-0.505, 0.22, 0], rotation: [-8e-7, 0.6576028, 0.7533648, 3e-7] }, mass: 0.32 },
  { bone: "thigh.R", restWorld: { translation: [0.485, 0.74, 0], rotation: [-0.0006321, 0.0708755, 0.9974452, -0.0089049] }, mass: 0.55 },
  { bone: "shin.R", restWorld: { translation: [0.49, 0.46, 0.04], rotation: [0.0025693, -0.082281, 0.9961205, -0.0310981] }, mass: 0.4 },
  { bone: "foot.R", restWorld: { translation: [0.505, 0.22, 0], rotation: [7e-7, 0.6576028, 0.7533648, -3e-7] }, mass: 0.32 },
];

const BASE_JOINTS: readonly BaseJoint[] = [
  { name: "pelvis_body", type: "spherical", bodyA: "pelvis", bodyB: "body", anchorA: [0, 0.5, 0], anchorB: [0, 0, 0] },
  { name: "body_head", type: "revolute", bodyA: "body", bodyB: "head", anchorA: [0, 0.8, 0], anchorB: [0, 0, 0], axis: [1, 0, 0], limits: [-0.1745329, 0.1745329], motor: { target: 0, stiffness: 7, damping: 1.8 } },
  { name: "shoulder_L", type: "spherical", bodyA: "body", bodyB: "upper_arm.L", anchorA: [-0.7, 0.8, 0], anchorB: [0, 0, 0] },
  { name: "elbow_L", type: "revolute", bodyA: "upper_arm.L", bodyB: "forearm.L", anchorA: [0, 0.596175, 0], anchorB: [0, 0, 0], axis: [1, 0, 0], limits: [-0.15, 2.55] },
  { name: "wrist_L", type: "spherical", bodyA: "forearm.L", bodyB: "hand.L", anchorA: [0, 0.314881, 0], anchorB: [0, 0, 0] },
  { name: "shoulder_R", type: "spherical", bodyA: "body", bodyB: "upper_arm.R", anchorA: [0.7, 0.8, 0], anchorB: [0, 0, 0] },
  { name: "elbow_R", type: "revolute", bodyA: "upper_arm.R", bodyB: "forearm.R", anchorA: [0, 0.596175, 0], anchorB: [0, 0, 0], axis: [1, 0, 0], limits: [-0.15, 2.55] },
  { name: "wrist_R", type: "spherical", bodyA: "forearm.R", bodyB: "hand.R", anchorA: [0, 0.314881, 0], anchorB: [0, 0, 0] },
  { name: "hip_L", type: "spherical", bodyA: "pelvis", bodyB: "thigh.L", anchorA: [-0.485, 0.06, 0], anchorB: [0, 0, 0] },
  { name: "knee_L", type: "revolute", bodyA: "thigh.L", bodyB: "shin.L", anchorA: [0, 0.282887, 0], anchorB: [0, 0, 0], axis: [1, 0, 0], limits: [-0.1, 2.35] },
  { name: "ankle_L", type: "spherical", bodyA: "shin.L", bodyB: "foot.L", anchorA: [0, 0.243772, 0], anchorB: [0, 0, 0] },
  { name: "hip_R", type: "spherical", bodyA: "pelvis", bodyB: "thigh.R", anchorA: [0.485, 0.06, 0], anchorB: [0, 0, 0] },
  { name: "knee_R", type: "revolute", bodyA: "thigh.R", bodyB: "shin.R", anchorA: [0, 0.282887, 0], anchorB: [0, 0, 0], axis: [1, 0, 0], limits: [-0.1, 2.35] },
  { name: "ankle_R", type: "spherical", bodyA: "shin.R", bodyB: "foot.R", anchorA: [0, 0.243772, 0], anchorB: [0, 0, 0] },
];

/** Bones the base table gives no angular damping of their own. */
const DEFAULT_ANGULAR_DAMPING = 1.1;

/**
 * Hard stops for the ball joints (the bench's, measured on `rubber.html`):
 * the cone half-angle per joint, the twist allowance every joint shares, and
 * how far from the pivot the ropes hold on (GLB units — a longer lever asks
 * less of the solver).
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
const ROPE_LEVER = 0.4;

const COLLIDER_MODEL = "models/blip_with_coliders.glb";
const RIG_MODEL = "models/BLIP.glb";

/** A hull point budget: enough for any silhouette here, cheap for the solver. */
const HULL_BUDGET = 256;

/** The extreme points of the hull around `points` — what Rapier would keep anyway. */
const hullExtremes = (points: THREE.Vector3[]): THREE.Vector3[] => {
  const hull = new ConvexHull().setFromPoints(points);
  const seen = new Set<string>();
  const kept: THREE.Vector3[] = [];
  for (const face of hull.faces) {
    let edge = face.edge;
    do {
      const point = edge.head().point;
      const key = `${point.x},${point.y},${point.z}`;
      if (!seen.has(key)) {
        seen.add(key);
        kept.push(point);
      }
      edge = edge.next;
    } while (edge !== face.edge);
  }
  return kept;
};

/**
 * The hull, held under {@link HULL_BUDGET} points: snapping the points to a
 * grid and hulling again drops the near-coplanar ones, coarsening only until
 * it fits. The first grid is 2 cm in GLB units.
 */
const hullPoints = (points: THREE.Vector3[]): THREE.Vector3[] => {
  let kept = hullExtremes(points);
  for (let grid = 0.02; kept.length > HULL_BUDGET; grid *= 1.6) {
    const cells = new Map<string, THREE.Vector3>();
    for (const p of points) {
      const key = `${Math.round(p.x / grid)},${Math.round(p.y / grid)},${Math.round(p.z / grid)}`;
      if (!cells.has(key)) {
        cells.set(key, new THREE.Vector3(Math.round(p.x / grid) * grid, Math.round(p.y / grid) * grid, Math.round(p.z / grid) * grid));
      }
    }
    kept = hullExtremes([...cells.values()]);
  }
  return kept;
};

const X_AXIS = new THREE.Vector3(1, 0, 0);

/**
 * What Rapier's revolute joint reads at the rest pose. Its hinge frame on each
 * body is the shortest-arc rotation taking local X to that body's axis, and
 * the joint angle is the twist of B's frame relative to A's about the hinge —
 * which at rest is not zero the moment the two bodies carry different rest
 * rotations. The authored limits are rest-relative (a knee bends 2.35 rad
 * *from standing*), so the bake shifts them by this angle. Measured before the
 * fix: the knees rested 0.21 rad OUTSIDE their own limits and both shins were
 * kicked at spawn.
 */
const restHingeAngle = (qA: THREE.Quaternion, qB: THREE.Quaternion, axisA: THREE.Vector3, axisB: THREE.Vector3): number => {
  const frameA = new THREE.Quaternion().setFromUnitVectors(X_AXIS, axisA);
  const frameB = new THREE.Quaternion().setFromUnitVectors(X_AXIS, axisB);
  const rel = frameA.premultiply(qA).invert().multiply(frameB.premultiply(qB));
  if (rel.w < 0) rel.set(-rel.x, -rel.y, -rel.z, -rel.w);
  return 2 * Math.atan2(rel.x, rel.w);
};

const round = (value: number): number => Math.round(value * 1e5) / 1e5;
const vec = (v: { x: number; y: number; z: number }): { x: number; y: number; z: number } => ({ x: round(v.x), y: round(v.y), z: round(v.z) });
const rot = (q: { x: number; y: number; z: number; w: number }): { x: number; y: number; z: number; w: number } => ({
  x: round(q.x),
  y: round(q.y),
  z: round(q.z),
  w: round(q.w),
});

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

const bake = async (): Promise<unknown> => {
  await initPhysics();
  const [rig, colliders] = await Promise.all([
    new GLTFLoader().loadAsync(publicUrl(RIG_MODEL)),
    new GLTFLoader().loadAsync(publicUrl(COLLIDER_MODEL)),
  ]);

  // The drawn rig's own placement (`characterModel.ts` / `rubber/main.ts`):
  // scaled to the Character's visual height, lowered so its lowest vertex
  // sits on the floor. The spec is baked in those sim units so nothing at
  // runtime scales.
  const bounds = new THREE.Box3().setFromObject(rig.scene);
  const glbHeight = bounds.getSize(new THREE.Vector3()).y;
  if (!(glbHeight > 0)) throw new Error("BLIP.glb measures no height");
  const scale = CHARACTER_VISUAL_HEIGHT / glbHeight;
  const drop = -bounds.min.y * scale;
  /** GLB frame (feet at the origin) → capsule frame (origin at the capsule centre). */
  const liftY = drop - CAPSULE_BOTTOM_OFFSET;

  // ---- the hulls: each COL_<bone> mesh's points, into the bone's own frame ----
  colliders.scene.updateMatrixWorld(true);
  const worldPoint = new THREE.Vector3();
  const hullOf = new Map<string, THREE.Vector3[]>();
  for (const body of BASE_BODIES) {
    const name = `COL_${body.bone}`;
    const node = boneOf(colliders.scene, name);
    const mesh = node as THREE.Mesh | null;
    // A missing mesh is an authoring error worth hearing about, not a bone to
    // silently drop.
    if (!mesh?.isMesh) throw new Error(`no "${name}" mesh in ${COLLIDER_MODEL}`);
    const positions = mesh.geometry.getAttribute("position");
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < positions.count; i += 1) {
      points.push(worldPoint.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld).clone());
    }
    const [tx, ty, tz] = body.restWorld.translation;
    const [qx, qy, qz, qw] = body.restWorld.rotation;
    const intoBone = new THREE.Quaternion(qx, qy, qz, qw).invert();
    hullOf.set(
      body.bone,
      hullPoints(points).map((p) => p.sub(new THREE.Vector3(tx, ty, tz)).applyQuaternion(intoBone).multiplyScalar(scale)),
    );
  }

  // ---- the bodies, in sim units around the capsule centre ----
  const restRotationOf = new Map(BASE_BODIES.map((b) => [b.bone, new THREE.Quaternion(...b.restWorld.rotation)] as const));
  const restTranslationOf = new Map(
    BASE_BODIES.map((b) => [b.bone, new THREE.Vector3(...b.restWorld.translation).multiplyScalar(scale)] as const),
  );
  const bones = BASE_BODIES.map((body) => ({
    bone: body.bone,
    rest: {
      position: vec({
        x: restTranslationOf.get(body.bone)!.x,
        y: restTranslationOf.get(body.bone)!.y + liftY,
        z: restTranslationOf.get(body.bone)!.z,
      }),
      rotation: rot(restRotationOf.get(body.bone)!),
    },
    hull: hullOf.get(body.bone)!.map((p) => vec(p)),
    mass: body.mass,
    angularDamping: body.angularDamping ?? DEFAULT_ANGULAR_DAMPING,
  }));

  // ---- the joints, every frame resolved (the bench's build, at bake time) ----
  const joints: unknown[] = [];
  for (const joint of BASE_JOINTS) {
    const qA = restRotationOf.get(joint.bodyA)!;
    const qB = restRotationOf.get(joint.bodyB)!;
    const tA = restTranslationOf.get(joint.bodyA)!;
    const tB = restTranslationOf.get(joint.bodyB)!;
    const anchorA = vec(new THREE.Vector3(...joint.anchorA).multiplyScalar(scale));
    const anchorB = vec(new THREE.Vector3(...joint.anchorB).multiplyScalar(scale));

    if (joint.type === "revolute") {
      // One hinge axis in the WORLD, written in bodyA's frame by the spec —
      // and expressed per body, because the two bodies' rest rotations
      // differ. `JointData.revolute`'s single axis is read in BOTH local
      // frames, which is only the same hinge when both bodies rest at
      // identity; built that way, the elbows were misaligned 33.5° at rest
      // and snapped on spawn.
      const axisA = new THREE.Vector3(...(joint.axis ?? [1, 0, 0])).normalize();
      const worldAxis = axisA.clone().applyQuaternion(qA);
      const axisB = worldAxis.clone().applyQuaternion(qB.clone().invert()).normalize();
      const restAngle = restHingeAngle(qA, qB, axisA, axisB);
      const limits = joint.limits ?? [-Math.PI, Math.PI];
      joints.push({
        type: "revolute",
        a: joint.bodyA,
        b: joint.bodyB,
        anchorA,
        anchorB,
        axisA: vec(axisA),
        axisB: vec(axisB),
        limits: [round(limits[0] + restAngle), round(limits[1] + restAngle)],
        ...(joint.motor
          ? { motor: { target: round(joint.motor.target + restAngle), stiffness: joint.motor.stiffness, damping: joint.motor.damping } }
          : {}),
      });
      continue;
    }

    joints.push({ type: "spherical", a: joint.bodyA, b: joint.bodyB, anchorA, anchorB });

    // Two ropes per ball joint, both length 0 at rest so they can never kick
    // at spawn: one to a point ON the child's bone axis (a point on the axis
    // never moves under twist — a pure swing stop, a hard cone around the
    // rest direction), one to a point OFF the axis (a point at radius r moves
    // 2·r·sin(θ/2) under ANY rotation — swing and twist alike — so it caps
    // the total turn at swing + a twist allowance; rotation cannot be
    // decomposed by a distance constraint, which is why twist is a budget).
    const lever = ROPE_LEVER * scale;
    const swing = SWING_LIMIT[joint.name] ?? 1.0;
    const pivotB = new THREE.Vector3(anchorB.x, anchorB.y, anchorB.z);
    const rope = (childLocal: THREE.Vector3, maxAngle: number): unknown => {
      // The point's rest position, world, then said in the parent's frame —
      // so at rest both rope ends coincide and the rope reads length 0.
      const restWorld = childLocal.clone().applyQuaternion(qB).add(tB);
      const parentLocal = restWorld.sub(tA).applyQuaternion(qA.clone().invert());
      return {
        type: "rope",
        a: joint.bodyA,
        b: joint.bodyB,
        anchorA: vec(parentLocal),
        anchorB: vec(childLocal),
        length: round(2 * lever * Math.sin(Math.min(Math.PI / 2, maxAngle / 2))),
      };
    };
    joints.push(rope(pivotB.clone().add(new THREE.Vector3(0, lever, 0)), swing));
    joints.push(rope(pivotB.clone().add(new THREE.Vector3(lever, 0, 0)), swing + TWIST_BUDGET));
  }

  // ---- the rest-overlap probe (the bench's): which bones the artist
  // modelled interpenetrating. The probe world is a throwaway with no
  // gravity, and its bodies are ordinary dynamics: contacts on the first step
  // are evaluated at the rest pose itself, before anything has moved.
  // (`Fixed` probe bodies would be tidier, but Rapier never looks at a
  // fixed-fixed pair — measured, not assumed.) The real colliders wear a
  // contact skin, so the skinless probe draws the line where the skinned
  // surfaces would meet.
  const probe = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const boneOfHandle = new Map<number, string>();
  const probeColliders: RAPIER.Collider[] = [];
  for (const bone of bones) {
    const flat = new Float32Array(bone.hull.length * 3);
    for (const [i, p] of bone.hull.entries()) {
      flat[i * 3] = p.x;
      flat[i * 3 + 1] = p.y;
      flat[i * 3 + 2] = p.z;
    }
    const desc = RAPIER.ColliderDesc.convexHull(flat);
    if (!desc) throw new Error(`the probe could not wrap "${bone.bone}"`);
    const rigid = probe.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(bone.rest.position.x, bone.rest.position.y, bone.rest.position.z).setRotation(bone.rest.rotation),
    );
    const collider = probe.createCollider(desc, rigid);
    boneOfHandle.set(collider.handle, bone.bone);
    probeColliders.push(collider);
  }
  probe.step();
  const touchingWithSkin = 2 * RAGDOLL_CONTACT_SKIN;
  const touching = new Set<string>();
  for (const collider of probeColliders) {
    probe.contactPairsWith(collider, (other) => {
      let penetrates = false;
      probe.contactPair(collider, other, (manifold) => {
        for (let i = 0; i < manifold.numContacts(); i += 1) {
          if (manifold.contactDist(i) < touchingWithSkin) penetrates = true;
        }
      });
      if (penetrates) touching.add(pairKey(boneOfHandle.get(collider.handle)!, boneOfHandle.get(other.handle)!));
    });
  }
  probe.free();
  const restTouching = [...touching].sort().map((key) => key.split("|") as [string, string]);
  // Joined pairs already run with contacts off; listing them again would be noise.
  const joined = new Set(BASE_JOINTS.map((j) => pairKey(j.bodyA, j.bodyB)));
  const restTouchingUnjoined = restTouching.filter(([a, b]) => !joined.has(pairKey(a, b)));

  // ---- the get-up clips' first frames, captured off the rig itself, placed
  // exactly as the game places it: scaled, lowered onto the floor, origin at
  // the feet, facing +Z. Physics bodies sit on the bone pivots, so a bone's
  // world transform IS its body's sweep target.
  rig.scene.scale.setScalar(scale);
  rig.scene.position.set(0, drop, 0);
  rig.scene.rotation.set(0, 0, 0);
  const mixer = new THREE.AnimationMixer(rig.scene);
  const getUpPose = (clipName: string): { bones: unknown[] } => {
    const clip = THREE.AnimationClip.findByName(rig.animations, clipName);
    if (!clip) throw new Error(`no "${clipName}" clip in ${RIG_MODEL}`);
    const action = mixer.clipAction(clip);
    action.reset().play();
    mixer.update(0);
    rig.scene.updateMatrixWorld(true);
    const captured = BASE_BODIES.map((body) => {
      const bone = boneOf(rig.scene, body.bone);
      if (!bone) throw new Error(`no "${body.bone}" bone in ${RIG_MODEL}`);
      return {
        position: vec(bone.getWorldPosition(new THREE.Vector3())),
        rotation: rot(bone.getWorldQuaternion(new THREE.Quaternion())),
      };
    });
    action.stop();
    mixer.uncacheClip(clip);
    return { bones: captured };
  };
  const getUp = { F: getUpPose("GetUp_F"), B: getUpPose("GetUp_B") };

  return {
    bones,
    joints,
    restTouching: restTouchingUnjoined,
    getUp,
    bake: { model: RIG_MODEL, colliders: COLLIDER_MODEL, scale: round(scale), drop: round(drop) },
  };
};

const status = document.querySelector("#status")!;
bake().then(
  (spec) => {
    window.dontFallRagdollBake = { ready: true, spec };
    status.textContent = "baked — the script is reading it";
  },
  (error: unknown) => {
    window.dontFallRagdollBake = { ready: false, error: String(error) };
    status.textContent = String(error);
  },
);
