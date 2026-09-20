import RAPIER from "@dimforge/rapier3d-compat";
import { mulQuat, slerpQuat, yawQuat, type Quat } from "../../math/quat.js";
import { lerpVec3, rotateVec3ByQuat, vec3, type Vec3 } from "../../math/vec3.js";
import {
  RAGDOLL_CONTACT_SKIN,
  RAGDOLL_FRICTION,
  RAGDOLL_LINEAR_DAMPING,
  RAGDOLL_RESTITUTION,
  RAGDOLL_SOLVER_ITERATIONS,
} from "../../tuning/knockdown.js";
import { RAGDOLL_GROUPS } from "../collisionGroups.js";
import type { BoneSnapshot } from "../ragdollSkeleton.js";
import { BLIP_RAGDOLL_SPEC } from "./blipRagdollSpec.js";
import { getUpTargetOf, type GetUpMatch } from "./getUp.js";
import type { BlipRagdollSpec } from "./spec.js";

const ZERO = { x: 0, y: 0, z: 0 };

/**
 * The three.js yaw the drawn rig stands at for a Character facing `facing`
 * (ADR 0045): the renderers draw the model at `π + MODEL_YAW_OFFSET − facing`
 * (`modelFacing.ts`, with BLIP's offset 0), and the baked rest pose faces the
 * rig's own +Z at yaw 0 — so this is the yaw {@link AuthoredRagdoll.activate}
 * needs for the doll to spawn exactly under the drawn body. At facing 0 the
 * rig's +Z points down world −Z, which is `forwardOf(0)`.
 */
export const modelYawOfFacing = (facing: number): number => Math.PI - facing;

/** A rope this long between two bones of one body can never go taut — it exists only to switch their contacts off. */
const NEVER_TAUT = 1000;

interface AuthoredBone {
  name: string;
  rest: { position: Vec3; rotation: Quat };
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

/**
 * The Character's ragdoll, built from the baked authored spec
 * (`blipRagdollSpec.ts`, `pnpm bake:ragdoll`): fifteen dynamic bodies on
 * BLIP's own rig pivots wearing the Blender-authored convex hulls, hinges
 * with per-body axes and rest-shifted limits, and rope-stop swing cones +
 * twist budgets on every ball joint — the rubber bench's recipe
 * (`.scratch/physical-ragdoll`, ticket 01), replacing the eleven-capsule
 * `Ragdoll`.
 *
 * The lifecycle is the old class's exactly: built once per Character, bones
 * `Fixed` with colliders disabled while inactive, {@link activate} snaps the
 * rest pose around the capsule centre and lets physics take over,
 * {@link deactivate} freezes it. `SimState` never holds any of these handles
 * (ADR 0009).
 */
export class AuthoredRagdoll {
  private readonly world: RAPIER.World;
  private readonly spec: BlipRagdollSpec;
  private readonly bones: AuthoredBone[] = [];
  private readonly byName = new Map<string, RAPIER.RigidBody>();
  private active = false;
  /** The heap each bone sweeps out of — captured by {@link startSweep}. */
  private sweepFrom: BoneSnapshot[] = [];
  /** The grip a hold carries this body by (ticket 04), and where it sits relative to the carry point. */
  private hang: { anchor: RAPIER.RigidBody; joint: RAPIER.ImpulseJoint } | null = null;
  private hangOffset: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(world: RAPIER.World, spec: BlipRagdollSpec = BLIP_RAGDOLL_SPEC) {
    this.world = world;
    this.spec = spec;
    for (const spine of ["pelvis", "body"]) {
      if (!spec.bones.some((bone) => bone.bone === spine)) {
        // Loud rather than silent: the root follow and the chest impulse
        // resolve these two names, and a spec without them would only fail
        // on the first knockdown.
        throw new Error(`AuthoredRagdoll: the spec names no "${spine}" bone`);
      }
    }

    for (const bone of spec.bones) {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(bone.rest.position.x, bone.rest.position.y, bone.rest.position.z)
          .setRotation(bone.rest.rotation)
          .setLinearDamping(RAGDOLL_LINEAR_DAMPING)
          // Per bone, the spec's own: how fast a limb's spin bleeds away is
          // part of the authored feel (the head carries more than a shin).
          .setAngularDamping(bone.angularDamping)
          .setAdditionalSolverIterations(RAGDOLL_SOLVER_ITERATIONS)
          .setCanSleep(false),
      );
      const flat = new Float32Array(bone.hull.length * 3);
      for (const [i, point] of bone.hull.entries()) {
        flat[i * 3] = point.x;
        flat[i * 3 + 1] = point.y;
        flat[i * 3 + 2] = point.z;
      }
      const hull = RAPIER.ColliderDesc.convexHull(flat);
      // Rapier answers null for points it cannot wrap — a bone with no
      // collider would fall through the world without a word about it.
      if (!hull) throw new Error(`AuthoredRagdoll: no hull for "${bone.bone}"`);
      const collider = world.createCollider(
        hull
          .setMass(bone.mass)
          .setFriction(RAGDOLL_FRICTION)
          .setRestitution(RAGDOLL_RESTITUTION)
          .setContactSkin(RAGDOLL_CONTACT_SKIN)
          .setCollisionGroups(RAGDOLL_GROUPS)
          .setEnabled(false),
        body,
      );
      this.bones.push({ name: bone.bone, rest: bone.rest, body, collider });
      this.byName.set(bone.bone, body);
    }

    for (const joint of spec.joints) {
      const a = this.byName.get(joint.a);
      const b = this.byName.get(joint.b);
      if (!a || !b) throw new Error(`AuthoredRagdoll: joint between unknown bones "${joint.a}"/"${joint.b}"`);
      const data =
        joint.type === "spherical"
          ? RAPIER.JointData.spherical(joint.anchorA, joint.anchorB)
          : joint.type === "rope"
            ? RAPIER.JointData.rope(joint.length, joint.anchorA, joint.anchorB)
            : RAPIER.JointData.revoluteWithAxes(joint.anchorA, joint.anchorB, joint.axisA, joint.axisB);
      const made = this.world.createImpulseJoint(data, a, b, true);
      // Bones that share a joint overlap at it by construction; with
      // self-collision on (ADR 0047) their contact would be a permanent
      // shove pushing the skeleton apart from the inside.
      made.setContactsEnabled(false);
      if (joint.type === "revolute") {
        // Loud rather than silent: a hinge whose limits never got set still
        // swings freely, which holds LESS shape than the ball joint it
        // replaced while looking like it works.
        if (!(made instanceof RAPIER.RevoluteImpulseJoint)) {
          throw new Error(`AuthoredRagdoll: "${joint.a}→${joint.b}" wanted a limited hinge but Rapier returned an unlimitable joint`);
        }
        made.setLimits(joint.limits[0], joint.limits[1]);
        // Tone of its own (the neck): pulled back toward an angle rather
        // than only hanging from its joint. Target already rest-shifted.
        if (joint.motor) made.configureMotorPosition(joint.motor.target, joint.motor.stiffness, joint.motor.damping);
      }
    }

    // Pairs authored interpenetrating at rest can never be pushed apart
    // without deforming the rest pose, so their contact only injects energy
    // (see the spec). A rope that can never go taut is how two unjointed
    // bodies get their contacts switched off.
    for (const [nameA, nameB] of spec.restTouching) {
      const a = this.byName.get(nameA);
      const b = this.byName.get(nameB);
      if (!a || !b) continue;
      this.world.createImpulseJoint(RAPIER.JointData.rope(NEVER_TAUT, ZERO, ZERO), a, b, true).setContactsEnabled(false);
    }
  }

  get isActive(): boolean {
    return this.active;
  }

  /**
   * One bone's body, by spec name — the grip joint holds the `body` bone
   * (ticket 04), the get-up sweep steers each one (ticket 03), and the tests
   * pin limbs to probe the joints.
   */
  bodyOf(name: string): RAPIER.RigidBody | undefined {
    return this.byName.get(name);
  }

  /**
   * Snap every bone into the rest pose around `root` (the capsule centre),
   * turned to `yaw` — a Character faces somewhere when it goes down, and a
   * doll built facing +Z under a turned body snaps the mesh around on the
   * first drawn frame. Hand it `velocity` plus an `impulse` on the chest, and
   * let physics take over.
   */
  activate(root: Vec3, yaw: number, velocity: Vec3, impulse: Vec3): void {
    const facing = yawQuat(yaw);
    for (const { rest, body, collider } of this.bones) {
      const at = rotateVec3ByQuat(rest.position, facing);
      body.setTranslation({ x: root.x + at.x, y: root.y + at.y, z: root.z + at.z }, false);
      body.setRotation(mulQuat(facing, rest.rotation), false);
      body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      body.setLinvel(velocity, true);
      body.setAngvel(ZERO, true);
      collider.setEnabled(true);
      // M6.1, found live ("a full Hit knocks nobody down"): Rapier derives a
      // body's mass from its colliders at the *next* step, so a bone that has
      // been sitting `Fixed` still reports `mass() === 0` right here, and
      // `applyImpulse` divides by that mass. Recomputing is Rapier's own
      // documented remedy.
      body.recomputeMassPropertiesFromColliders();
    }
    // The chest — the spec's `body` bone, the one carrying the torso's mass.
    this.byName.get("body")!.applyImpulse(impulse, true);
    this.active = true;
  }

  /** Shove the chest — a fresh Impact landing on a Character that is already down. */
  applyImpulse(impulse: Vec3): void {
    if (this.active) this.byName.get("body")!.applyImpulse(impulse, true);
  }

  /** Freeze the ragdoll in place (the renderer stops drawing it once bones are empty). */
  deactivate(): void {
    this.endHang(null);
    for (const { body, collider } of this.bones) {
      collider.setEnabled(false);
      body.setLinvel(ZERO, false);
      body.setAngvel(ZERO, false);
      body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
    }
    this.active = false;
  }

  /** Weight applied to angular speed when comparing against the linear settle threshold. */
  private static readonly ANGULAR_SETTLE_WEIGHT = 0.3;

  /** Fastest bone speed (units/s), linear or weighted angular — for the settled check. */
  maxSpeed(): number {
    let max = 0;
    for (const { body } of this.bones) {
      const v = body.linvel();
      const w = body.angvel();
      max = Math.max(max, Math.hypot(v.x, v.y, v.z), Math.hypot(w.x, w.y, w.z) * AuthoredRagdoll.ANGULAR_SETTLE_WEIGHT);
    }
    return max;
  }

  /** The pelvis position — the point the camera follows while ragdolling. */
  rootPosition(): Vec3 {
    const t = this.byName.get("pelvis")!.translation();
    return vec3(t.x, t.y, t.z);
  }

  /**
   * The pelvis's current linear velocity — what a reconciling client reports
   * as `CharacterSnapshot.velocity` while Ragdoll, so a forced Bump snap has a
   * real launch to hand its own local ragdoll.
   */
  rootVelocity(): Vec3 {
    const v = this.byName.get("pelvis")!.linvel();
    return vec3(v.x, v.y, v.z);
  }

  /**
   * Shift the whole ragdoll so its pelvis sits at `root`, keeping the current
   * pose and bone velocities: each server snapshot re-anchors a client's own
   * flopping doll to the authoritative pelvis rather than letting the two
   * drift apart for the length of the knockdown.
   */
  snapRootTo(root: Vec3): void {
    if (!this.active) return;
    const pelvis = this.byName.get("pelvis")!.translation();
    const dx = root.x - pelvis.x;
    const dy = root.y - pelvis.y;
    const dz = root.z - pelvis.z;
    for (const { body } of this.bones) {
      const t = body.translation();
      body.setTranslation({ x: t.x + dx, y: t.y + dy, z: t.z + dz }, true);
    }
  }

  /**
   * Hung from a grabber's hands (`.scratch/physical-ragdoll` ticket 04): the
   * body is a real ragdoll gripped at the collar by a kinematic anchor the
   * hold carries. Activated first so the grip point can be measured off the
   * body itself — the anchor starts exactly on it, so the joint reads length
   * zero and nothing kicks at the catch.
   *
   * `root` is the capsule centre the hold places, and the offset from it to
   * the grip is kept: {@link moveHang} takes the same carry point the capsule
   * gets, so the drawn body and the simulation's own body track together.
   */
  beginHang(root: Vec3, yaw: number, velocity: Vec3, gripAboveChest: number): void {
    this.activate(root, yaw, velocity, ZERO);
    const chest = this.byName.get("body")!;
    const at = chest.translation();
    const r = chest.rotation();
    const lift = rotateVec3ByQuat({ x: 0, y: gripAboveChest, z: 0 }, { x: r.x, y: r.y, z: r.z, w: r.w });
    const grip = { x: at.x + lift.x, y: at.y + lift.y, z: at.z + lift.z };
    this.hangOffset = { x: grip.x - root.x, y: grip.y - root.y, z: grip.z - root.z };
    const anchor = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(grip.x, grip.y, grip.z),
    );
    this.hang = {
      anchor,
      joint: this.world.createImpulseJoint(
        RAPIER.JointData.spherical(ZERO, { x: 0, y: gripAboveChest, z: 0 }),
        anchor,
        chest,
        true,
      ),
    };
  }

  /** Carry the hang to this tick's carry point — the same one the capsule is placed at. */
  moveHang(point: Vec3): void {
    if (!this.hang) return;
    this.hang.anchor.setNextKinematicTranslation({
      x: point.x + this.hangOffset.x,
      y: point.y + this.hangOffset.y,
      z: point.z + this.hangOffset.z,
    });
  }

  /** Whether a hold is carrying this body right now. */
  get isHanging(): boolean {
    return this.hang !== null;
  }

  /**
   * Let go: the grip and its anchor leave the world and the bones keep
   * flying with whatever the carry really gave them. `launch` replaces each
   * bone's linear velocity (a Hurl's aimed, clamped throw) and leaves the
   * angular alone, so the body keeps the tumble the spin wound into it.
   */
  endHang(launch: Vec3 | null): void {
    if (!this.hang) return;
    this.world.removeImpulseJoint(this.hang.joint, true);
    this.world.removeRigidBody(this.hang.anchor);
    this.hang = null;
    if (launch) for (const { body } of this.bones) body.setLinvel(launch, true);
  }

  /**
   * The get-up drive's opening move (ticket 03): every bone goes
   * `KinematicPositionBased` and the heap is captured as the sweep's start.
   * Kinematic, never a velocity pull toward the pose — the clip lies the
   * skin on the floor, the colliders reach below it, and a dynamic drive
   * fought the contacts every tick (the bench's measured bouncing). A
   * kinematic sweep cannot be fought; it ends exactly on the clip's frame.
   */
  startSweep(): void {
    this.sweepFrom = this.readBones();
    for (const { body } of this.bones) body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
  }

  /**
   * One tick of the sweep, before the world steps: every bone carried
   * `eased` (0..1, the caller's smoothstep) of the way from its heap
   * transform onto `match`'s placed clip pose, on the floor at `floorY`.
   */
  sweepStep(match: GetUpMatch, floorY: number, eased: number): void {
    for (const [i, { body }] of this.bones.entries()) {
      const target = getUpTargetOf(match, i, floorY, this.spec);
      const from = this.sweepFrom[i];
      if (!target || !from) continue;
      body.setNextKinematicTranslation(lerpVec3(from.position, target.position, eased));
      body.setNextKinematicRotation(slerpQuat(from.rotation, target.rotation, eased));
    }
  }

  /** Per-bone world transforms, in the spec's wire order. */
  readBones(): BoneSnapshot[] {
    return this.bones.map(({ body }) => {
      const t = body.translation();
      const r = body.rotation();
      return { position: vec3(t.x, t.y, t.z), rotation: { x: r.x, y: r.y, z: r.z, w: r.w } };
    });
  }

  /** Remove every bone body (and its joints/collider) from the world. */
  dispose(): void {
    this.endHang(null);
    for (const { body } of this.bones) this.world.removeRigidBody(body);
  }
}
