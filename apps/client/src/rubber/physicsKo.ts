import RAPIER from "@dimforge/rapier3d-compat";
import {
  type BoneSnapshot,
  type BoneSpec,
  CAPSULE_BOTTOM_OFFSET,
  CAPSULE_HALF_HEIGHT,
  CAPSULE_RADIUS,
  GRAVITY_Y,
  initPhysics,
  Ragdoll,
  TICK_DT,
} from "@dont-fall/shared";
import * as THREE from "three";
import type { KnockdownDirection } from "../render/characterModel.js";
import { RagdollRig } from "../render/ragdollRig.js";
import {
  type AuthoredVersion,
  authoredDrawBones,
  type BlipRagdoll,
  createBlipRagdoll,
  readAuthoredPose,
  syncBlipSkeletonFromRagdoll,
} from "./blipRagdoll.js";
import { SKELETONS, type SkeletonName } from "./blipSkeleton.js";

/**
 * A knockout with no animation in it: the real `Ragdoll` (ADR 0047 — eleven
 * bones, its joint limits, its self-collision) in a bare Rapier world with a
 * floor, drawn onto the rig by {@link RagdollRig}.
 *
 * The same class the Match server runs, stepped at the same fixed
 * {@link TICK_DT}, so what this shows is what the game would do — not an
 * approximation of it. The world holds nothing but a floor, which is the one
 * difference: a real Track's geometry would catch a limb here and there.
 */

/** How hard a magnitude-1 Impact shoves the chest. */
export const PHYSICS_KO_IMPULSE = 90;
/** How long a knockout is watched before the rig is handed back (ms). */
export const PHYSICS_KO_MS = 6000;
/** The knockout's final stretch, spent carrying the doll into the get-up's first frame (ms). */
export const GETUP_DRIVE_MS = 900;

/**
 * The invisible grabber's Spin and Hurl (ADR 0104's moves, made physical for
 * the bench): the doll is held at the collar by a ball joint on a kinematic
 * anchor that orbits the character's own spot, winding up; letting go throws
 * the body with whatever velocity the spin really gave it — no authored
 * impulse anywhere. Every number is a first guess for the eye.
 */
export const SPIN_UP_MS = 1600;
/** Full wind: a bit over one revolution per second. */
export const SPIN_MAX_RAD_S = 8;
/** The grabber lets go by itself after this much spinning; the button can let go sooner. */
export const SPIN_AUTO_HURL_MS = 3600;
/** Arm's length — how far from the grabber the catch is carried. Wide enough that two eggs clear each other. */
export const HOLD_RADIUS = 0.9;
/** How high the catch is carried (world units). */
export const HOLD_HEIGHT = 1.05;
/** Floor to carry height, and out to arm's length (ms). */
export const HOLD_LIFT_MS = 450;

/** A pose to reach: world transforms per spec bone, captured with the character at the origin facing +Z. */
export type GetUpPose = ReadonlyMap<string, { position: THREE.Vector3; quaternion: THREE.Quaternion }>;

/** Where a knockout left the body, so the character can get up there instead of teleporting home. */
export interface Landing {
  /** The pelvis, world. */
  position: { x: number; y: number; z: number };
  /** Which way the risen character should face (rad about +Y) — a first guess for the eye. */
  yaw: number;
  /** Which `GetUp_<d>` reads best from how the body lies. */
  side: KnockdownDirection;
  /**
   * True when the knockout's final stretch carried the doll onto that clip's
   * exact first frame — the clip can then start at full weight with no
   * blending at all, because the world pose already matches. Blending is for
   * the fallback only: the heap and the clip encode "lying" differently
   * (bone positions under an upright root vs a pitched root), and
   * interpolating locals between two encodings of even the SAME world pose
   * sweeps the body through nonsense.
   */
  driven: boolean;
}

export interface PhysicsKnockout {
  /** True while the rig is being drawn from physics rather than from a clip. */
  readonly active: boolean;
  /** True while an invisible grabber is winding the doll up — `hurl` lets go. */
  readonly holding: boolean;
  /**
   * The grabber's live state while it winds up, for drawing a real one over
   * the physics: where it stands, which way it faces (at the catch), and the
   * actual angular speed this tick — the lean is derived from that, not
   * animated. Null when nothing is held.
   */
  readonly hold: { pivotX: number; pivotZ: number; yaw: number; omega: number } | null;
  /** The bones of whichever skeleton is on screen, for drawing them. */
  readonly skeleton: { name: SkeletonName; bones: readonly BoneSpec[]; pose: readonly BoneSnapshot[] };
  /** Knock the Character down, shoved along `direction` at `magnitude` (0–1). */
  start: (
    origin: THREE.Vector3,
    direction: { x: number; z: number },
    magnitude: number,
    nowMs: number,
    /** Which skeleton to knock down, by name and by its numbers as they stand now. */
    skeleton: { name: SkeletonName; bones: readonly BoneSpec[] },
  ) => void;
  /**
   * Grab the doll and wind it up about the character's own spot. Authored
   * skeletons only — the shared-Ragdoll path has no doll to hold.
   */
  startSpin: (nowMs: number, skeleton: { name: SkeletonName; bones: readonly BoneSpec[] }) => void;
  /** Let go mid-spin: the body flies with the velocity the spin really gave it. */
  hurl: (nowMs: number) => void;
  /** Steps the world on a fixed clock and draws the result. Returns false once it is over. */
  update: (nowMs: number) => boolean;
  stop: () => void;
}

/**
 * Builds the world and the ragdoll once. `carrier` is the group the model
 * hangs in — the knockout moves it, and `restPosition` is where it goes back
 * to afterwards.
 */
export const createPhysicsKnockout = async (
  model: THREE.Object3D,
  carrier: THREE.Object3D,
  restPosition: THREE.Vector3,
  /**
   * How the authored rig is placed: its own units scaled, and where its feet
   * stand — read fresh per knockout, because a get-up moves the character.
   */
  authored: { scale: number; origin: () => THREE.Vector3; yaw: () => number },
  /**
   * Called the moment an authored knockout ends, with the body still in its
   * final heap: the page moves the carrier there, and the skeleton is synced
   * once more against the moved carrier before the doll is taken away — so
   * the pose survives the hand-over and the get-up can blend out of it.
   */
  onGetUp?: (landing: Landing) => void,
  /**
   * The get-up clips' first frames. In the knockout's last `GETUP_DRIVE_MS`
   * the doll is steered into the one matching how it lies — physics ends
   * where the clip begins, so the hand-over has nothing left to hide.
   */
  getUpStart?: { F: GetUpPose | null; B: GetUpPose | null },
): Promise<PhysicsKnockout> => {
  await initPhysics();
  const world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
  // A floor wide enough that nothing slides off it, and thick enough that a
  // fast bone cannot tunnel through.
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(50, 1, 50).setTranslation(0, -1, 0),
    world.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
  );

  // One ragdoll per skeleton, built up front: both are only bodies sitting
  // `Fixed` with their colliders off until one is activated, so holding two
  // costs nothing and switching between them is instant.
  let built: { bones: readonly BoneSpec[]; ragdoll: Ragdoll; rig: RagdollRig } | null = null;
  /**
   * The authored rig runs on its own path: bodies on the rig's own pivots,
   * joints with their own anchors and limits, and the armature posed straight
   * from the bodies. None of that fits `BoneSpec`, so none of it is squeezed in.
   */
  let authoredDoll: BlipRagdoll | null = null;
  /** Which authored description a name asks for. */
  const versionOf = (name: SkeletonName): AuthoredVersion =>
    name === "authoredV4" ? "v4" : name === "authoredV3" ? "v3" : name === "authoredV2" ? "v2" : "v1";
  let which: SkeletonName = "game";
  let liveBones: readonly BoneSpec[] = SKELETONS.game.bones as readonly BoneSpec[];

  /** Builds the ragdoll for `bones`, reusing the last one while the numbers have not moved. */
  const use = (bones: readonly BoneSpec[]): { ragdoll: Ragdoll; rig: RagdollRig } => {
    if (built && built.bones === bones) return built;
    built?.ragdoll.dispose();
    const rig = new RagdollRig(model, carrier, bones.map((b) => b.name));
    if (!rig.complete) console.warn("physics KO: the rig is missing nodes this skeleton poses");
    built = { bones, ragdoll: new Ragdoll(world, bones), rig };
    return built;
  };

  const UP = new THREE.Vector3(0, 1, 0);
  let active = false;
  let startedAt = 0;
  /** Simulated time owed to the world, so it steps on its own fixed clock and not the frame's. */
  let owedSeconds = 0;
  let lastMs = 0;

  /** Locked the moment the drive begins: which get-up, where, facing what, and out of which heap. */
  let driven: {
    side: "F" | "B";
    yaw: number;
    offsetX: number;
    offsetZ: number;
    pose: GetUpPose;
    from: Map<string, { position: THREE.Vector3; quaternion: THREE.Quaternion }>;
  } | null = null;
  const driveFacing = new THREE.Quaternion();
  const driveTarget = new THREE.Vector3();
  const driveQ = new THREE.Quaternion();
  const driveGoalQ = new THREE.Quaternion();

  /**
   * Carries the doll from its heap into the matching get-up's first frame
   * over the knockout's last `GETUP_DRIVE_MS`. The bodies go KINEMATIC for
   * this: the ragdoll has already had its fall, and any dynamic pull toward
   * the clip pose fights the contacts on the way — the clip lies the skin
   * on the floor, the (inflated) colliders reach below it, and the solver
   * threw the body back out every tick: the bouncing the user saw. A
   * kinematic sweep cannot be fought; it ends exactly on the clip's frame.
   */
  const driveTowardGetUp = (nowMs: number): void => {
    if (!authoredDoll || !getUpStart) return;
    const driveFrom = startedAt + PHYSICS_KO_MS - GETUP_DRIVE_MS;
    if (nowMs < driveFrom) return;
    if (!driven) {
      const r = authoredDoll.bodies.get("body")!.rotation();
      const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
      const belly = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      const spine = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      const side = belly.y < 0 ? "F" : "B";
      const pose = getUpStart[side];
      if (!pose) return;
      // No guess about the clip's own lying convention: the captured pose
      // is turned so ITS head lies where the doll's head lies, and pinned
      // so its pelvis sits over the doll's.
      const clipPelvis = pose.get("pelvis")!.position;
      const clipHead = pose.get("head")!.position;
      const yaw =
        Math.atan2(spine.x, spine.z) - Math.atan2(clipHead.x - clipPelvis.x, clipHead.z - clipPelvis.z);
      driveFacing.setFromAxisAngle(UP, yaw);
      const pelvis = authoredDoll.bodies.get("pelvis")!.translation();
      const atYaw = clipPelvis.clone().applyQuaternion(driveFacing);
      const from = new Map<string, { position: THREE.Vector3; quaternion: THREE.Quaternion }>();
      for (const [bone, body] of authoredDoll.bodies) {
        const p = body.translation();
        const br = body.rotation();
        from.set(bone, {
          position: new THREE.Vector3(p.x, p.y, p.z),
          quaternion: new THREE.Quaternion(br.x, br.y, br.z, br.w),
        });
        body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      }
      driven = { side, yaw, pose, from, offsetX: pelvis.x - atYaw.x, offsetZ: pelvis.z - atYaw.z };
    }
    const w = Math.min(1, (nowMs - driveFrom) / GETUP_DRIVE_MS);
    const eased = w * w * (3 - 2 * w);
    driveFacing.setFromAxisAngle(UP, driven.yaw);
    for (const [bone, body] of authoredDoll.bodies) {
      const target = driven.pose.get(bone);
      const from = driven.from.get(bone);
      if (!target || !from) continue;
      driveTarget.copy(target.position).applyQuaternion(driveFacing);
      driveTarget.x += driven.offsetX;
      driveTarget.z += driven.offsetZ;
      driveTarget.lerpVectors(from.position, driveTarget, eased);
      driveGoalQ.copy(target.quaternion).premultiply(driveFacing);
      driveQ.copy(from.quaternion).slerp(driveGoalQ, eased);
      body.setNextKinematicTranslation({ x: driveTarget.x, y: driveTarget.y, z: driveTarget.z });
      body.setNextKinematicRotation({ x: driveQ.x, y: driveQ.y, z: driveQ.z, w: driveQ.w });
    }
  };

  /**
   * How the body lies, read off the pelvis and the torso. The yaw and the
   * diagonal picks are first guesses for the eye — the clip names say F/B
   * with FL/FR/BL/BR for a body that rolled onto its side. A driven landing
   * is already decided: it reports the pose the doll was steered into.
   */
  const landingOf = (doll: BlipRagdoll): Landing => {
    if (driven) {
      // The carrier goes to the CLIP FRAME's origin, not to the pelvis: the
      // clip's own first frame carries a pelvis offset, and playing it from
      // the pelvis would shift the whole body at hand-over.
      const pelvis = doll.bodies.get("pelvis")!.translation();
      return {
        position: { x: driven.offsetX, y: pelvis.y, z: driven.offsetZ },
        yaw: driven.yaw,
        side: driven.side,
        driven: true,
      };
    }
    const pelvis = doll.bodies.get("pelvis")!.translation();
    const r = doll.bodies.get("body")!.rotation();
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const spine = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const belly = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const front = belly.y < 0;
    // Fell forward: the head lies the way the body was going; backward: opposite.
    const yaw = front ? Math.atan2(spine.x, spine.z) : Math.atan2(-spine.x, -spine.z);
    const rolled = Math.abs(right.y) > 0.5;
    const side: KnockdownDirection = front
      ? rolled
        ? right.y > 0
          ? "FL"
          : "FR"
        : "F"
      : rolled
        ? right.y > 0
          ? "BR"
          : "BL"
        : "B";
    return { position: { x: pelvis.x, y: pelvis.y, z: pelvis.z }, yaw, side, driven: false };
  };

  /**
   * The bones physics does not drive — the GLB's `root`, the crest, the
   * eyes — still hold whatever clip played before the knockout. The sync
   * compensates the driven bones against them, so the WORLD pose is right,
   * but a heap captured over that stale root blends back out through it and
   * the body appears to roll over mid-get-up. Reset to bind first; the sync
   * then writes the heap against a clean root.
   */
  const restUndrivenBones = (): void => {
    model.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh) mesh.skeleton.pose();
    });
  };

  /** The grabber: its hand (a kinematic anchor), the hold joint, its own body in the world, and how wound up it is. */
  let spin: {
    pivot: THREE.Vector3;
    anchor: RAPIER.RigidBody;
    joint: RAPIER.ImpulseJoint | null;
    /** The grabber's own capsule, so the flailing (and the flying) body bounces off it instead of passing through. */
    bodyOf: RAPIER.RigidBody;
    since: number;
    angle: number;
    omega: number;
    from: THREE.Vector3;
  } | null = null;

  const disposeSpin = (): void => {
    if (!spin) return;
    if (spin.joint) world.removeImpulseJoint(spin.joint, true);
    world.removeRigidBody(spin.anchor);
    world.removeRigidBody(spin.bodyOf);
    spin = null;
  };

  const letGo = (nowMs: number): void => {
    if (!spin?.joint) return;
    world.removeImpulseJoint(spin.joint, true);
    spin.joint = null;
    // The flight is a knockout from here: same settle, same drive into the
    // get-up, same clip — the body carries only what the spin really gave it.
    startedAt = nowMs;
  };

  /** One tick of the wind-up: the grabber's hand carried along its orbit. */
  const advanceSpin = (nowMs: number): void => {
    if (!spin?.joint) return;
    const held = nowMs - spin.since;
    const wind = Math.min(1, held / SPIN_UP_MS);
    spin.omega = SPIN_MAX_RAD_S * (wind * wind * (3 - 2 * wind));
    spin.angle += spin.omega * TICK_DT;
    // Gathered off the floor and out to arm's length while the orbit starts.
    const lift = Math.min(1, held / HOLD_LIFT_MS);
    const ease = lift * lift * (3 - 2 * lift);
    const orbitX = spin.pivot.x + Math.sin(spin.angle) * HOLD_RADIUS;
    const orbitZ = spin.pivot.z + Math.cos(spin.angle) * HOLD_RADIUS;
    spin.anchor.setNextKinematicTranslation({
      x: spin.from.x + (orbitX - spin.from.x) * ease,
      y: spin.from.y + (HOLD_HEIGHT - spin.from.y) * ease,
      z: spin.from.z + (orbitZ - spin.from.z) * ease,
    });
    if (held > SPIN_AUTO_HURL_MS) letGo(nowMs);
  };

  /** Hands an authored knockout over to the get-up: land, move, one last sync, then let go. */
  const endAuthored = (): void => {
    if (!authoredDoll) return;
    disposeSpin();
    onGetUp?.(landingOf(authoredDoll));
    // Synced once more against the carrier as the get-up just moved it, so
    // the final heap survives the hand-over in the bones' own locals.
    restUndrivenBones();
    syncBlipSkeletonFromRagdoll(model, authoredDoll);
    authoredDoll.dispose();
    authoredDoll = null;
    driven = null;
  };

  return {
    get active() {
      return active;
    },
    get holding() {
      return spin?.joint != null;
    },
    get hold() {
      return spin?.joint
        ? { pivotX: spin.pivot.x, pivotZ: spin.pivot.z, yaw: spin.angle, omega: spin.omega }
        : null;
    },
    get skeleton() {
      if (which.startsWith("authored")) {
        const version = versionOf(which);
        return {
          name: which,
          bones: authoredDrawBones(authored.scale, version, authored.origin().y, authored.yaw()),
          pose: authoredDoll ? readAuthoredPose(authoredDoll, authored.scale, version) : [],
        };
      }
      return { name: which, bones: liveBones, pose: built?.ragdoll.readBones() ?? [] };
    },
    start: (origin, direction, magnitude, nowMs, skeleton) => {
      const length = Math.hypot(direction.x, direction.z) || 1;
      const shove = (magnitude * PHYSICS_KO_IMPULSE) / length;
      built?.ragdoll.deactivate();
      // A knockout thrown into a knockout still lands the first one, so the
      // new doll spawns where the body actually is.
      endAuthored();
      which = skeleton.name;
      liveBones = skeleton.bones;

      if (skeleton.name.startsWith("authored")) {
        authoredDoll = createBlipRagdoll(
          world,
          { scale: authored.scale, origin: authored.origin(), yaw: authored.yaw() },
          versionOf(skeleton.name),
        );
        // The same shove the other path gives, on the body carrying the mass.
        authoredDoll.bodies
          .get("body")
          ?.applyImpulse(
            { x: direction.x * shove, y: magnitude * PHYSICS_KO_IMPULSE * 0.3, z: direction.z * shove },
            true,
          );
        active = true;
        startedAt = nowMs;
        owedSeconds = 0;
        lastMs = nowMs;
        return;
      }

      const { ragdoll: next } = use(skeleton.bones);
      next.activate(
        { x: origin.x, y: origin.y, z: origin.z },
        { x: 0, y: 0, z: 0 },
        // A lift, so the body leaves the floor rather than grinding along it —
        // the same shape `HIT_LIFT_RATIO` gives an Impact in the game.
        { x: direction.x * shove, y: magnitude * PHYSICS_KO_IMPULSE * 0.3, z: direction.z * shove },
      );
      active = true;
      startedAt = nowMs;
      owedSeconds = 0;
      lastMs = nowMs;
    },
    startSpin: (nowMs, skeleton) => {
      if (!skeleton.name.startsWith("authored")) {
        console.warn("spin: only the authored dolls can be held");
        return;
      }
      built?.ragdoll.deactivate();
      endAuthored();
      which = skeleton.name;
      liveBones = skeleton.bones;
      const origin = authored.origin();
      authoredDoll = createBlipRagdoll(
        world,
        { scale: authored.scale, origin, yaw: authored.yaw() },
        versionOf(skeleton.name),
      );
      // Held at the collar. The anchor starts exactly on the grip point, so
      // the hold joint reads length zero and nothing kicks at the catch.
      const body = authoredDoll.bodies.get("body")!;
      const grip = 0.35 * authored.scale;
      const t = body.translation();
      const r = body.rotation();
      const gripWorld = new THREE.Vector3(0, grip, 0)
        .applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w))
        .add(new THREE.Vector3(t.x, t.y, t.z));
      const anchor = world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(gripWorld.x, gripWorld.y, gripWorld.z),
      );
      const joint = world.createImpulseJoint(
        RAPIER.JointData.spherical({ x: 0, y: 0, z: 0 }, { x: 0, y: grip, z: 0 }),
        anchor,
        body,
        true,
      );
      // The grabber stands an arm's length IN FRONT of its catch and the
      // orbit runs around HIM — so the two never start inside each other:
      // the victim begins exactly where it stood, on the orbit's rim.
      const yaw = authored.yaw();
      const pivot = new THREE.Vector3(
        origin.x + Math.sin(yaw) * HOLD_RADIUS,
        0,
        origin.z + Math.cos(yaw) * HOLD_RADIUS,
      );
      // And he is IN the world: the game's own Capsule, kinematic, so a
      // flailing limb — or the thrown body coming back around — bounces off
      // him instead of passing through.
      const bodyOf = world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pivot.x, CAPSULE_BOTTOM_OFFSET, pivot.z),
      );
      world.createCollider(RAPIER.ColliderDesc.capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS), bodyOf);
      spin = {
        pivot,
        anchor,
        joint,
        bodyOf,
        since: nowMs,
        // The orbit begins at the victim's own spot: the far side of the circle.
        angle: yaw + Math.PI,
        omega: 0,
        from: gripWorld,
      };
      active = true;
      startedAt = nowMs;
      owedSeconds = 0;
      lastMs = nowMs;
    },
    hurl: (nowMs) => letGo(nowMs),
    update: (nowMs) => {
      if (!active) return false;
      // While the grabber holds on, the knockout clock waits: settle, drive
      // and get-up all count from the moment it lets go.
      if (spin?.joint) startedAt = nowMs;
      owedSeconds += Math.min(0.25, Math.max(0, (nowMs - lastMs) / 1000));
      lastMs = nowMs;
      while (owedSeconds >= TICK_DT) {
        advanceSpin(nowMs);
        // Per TICK, never per frame: the drive reads the error fresh before
        // every step, so one step can only ever close part of it. Set once
        // per frame, a slow frame ran several steps on the same velocity,
        // overshot the target and the next frame threw it back — the body
        // visibly bounced back and forth just before the clip.
        driveTowardGetUp(nowMs);
        world.step();
        owedSeconds -= TICK_DT;
      }
      if (authoredDoll) syncBlipSkeletonFromRagdoll(model, authoredDoll);
      else built?.rig.pose(built.ragdoll.readBones());
      if (nowMs - startedAt > PHYSICS_KO_MS) {
        active = false;
        endAuthored();
        built?.ragdoll.deactivate();
        built?.rig.release(restPosition);
        return false;
      }
      return true;
    },
    stop: () => {
      if (!active) return;
      active = false;
      endAuthored();
      built?.ragdoll.deactivate();
      built?.rig.release(restPosition);
    },
  };
};
