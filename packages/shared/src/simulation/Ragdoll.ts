import RAPIER from "@dimforge/rapier3d-compat";
import { IDENTITY_QUAT } from "../math/quat.js";
import { vec3, type Vec3 } from "../math/vec3.js";
import {
  RAGDOLL_ANGULAR_DAMPING,
  RAGDOLL_CONTACT_SKIN,
  RAGDOLL_FRICTION,
  RAGDOLL_LINEAR_DAMPING,
  RAGDOLL_SOLVER_ITERATIONS,
} from "../tuning.js";
import { RAGDOLL_GROUPS } from "./collisionGroups.js";
import {
  jointRestPoint,
  RAGDOLL_BONES,
  type BoneSnapshot,
  type BoneSpec,
} from "./ragdollSkeleton.js";

export type { BoneSnapshot };

const ZERO = { x: 0, y: 0, z: 0 };

interface Bone {
  spec: BoneSpec;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

/**
 * The Character's articulated ragdoll: 11 dynamic bones (ADR 0006, ticket
 * 05), hinged where a body hinges and ball-jointed where it doesn't (M6
 * ticket 05, ADR 0047). Built once; while inactive the bones are `Fixed`
 * with their colliders disabled (the renderer hides them). {@link activate} snaps
 * it into the standing pose and lets physics take over, {@link deactivate} freezes
 * it. `SimState` never holds any of these handles (ADR 0009).
 */
export class Ragdoll {
  private readonly world: RAPIER.World;
  private readonly bones: Bone[] = [];
  private readonly byName = new Map<string, RAPIER.RigidBody>();
  private active = false;

  constructor(world: RAPIER.World) {
    this.world = world;
    for (const spec of RAGDOLL_BONES) {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(spec.restCenter.x, spec.restCenter.y, spec.restCenter.z)
          .setAngularDamping(RAGDOLL_ANGULAR_DAMPING)
          .setLinearDamping(RAGDOLL_LINEAR_DAMPING)
          .setAdditionalSolverIterations(RAGDOLL_SOLVER_ITERATIONS) // ticket 08: survive a dash-crash into a Prop
          .setCanSleep(false),
      );
      const collider = world.createCollider(
        RAPIER.ColliderDesc.capsule(spec.halfHeight, spec.radius)
          .setMass(spec.mass)
          .setFriction(RAGDOLL_FRICTION)
          .setContactSkin(RAGDOLL_CONTACT_SKIN)
          .setCollisionGroups(RAGDOLL_GROUPS)
          .setEnabled(false),
        body,
      );
      this.bones.push({ spec, body, collider });
      this.byName.set(spec.name, body);
    }

    for (const spec of RAGDOLL_BONES) {
      if (!spec.parent) continue;
      const parentSpec = RAGDOLL_BONES.find((b) => b.name === spec.parent)!;
      const joint = jointRestPoint(spec, parentSpec);
      const anchorParent = {
        x: joint.x - parentSpec.restCenter.x,
        y: joint.y - parentSpec.restCenter.y,
        z: joint.z - parentSpec.restCenter.z,
      };
      const anchorChild = {
        x: joint.x - spec.restCenter.x,
        y: joint.y - spec.restCenter.y,
        z: joint.z - spec.restCenter.z,
      };
      // A hinge where the body actually hinges, a ball joint where it doesn't
      // (M6 ticket 05, ADR 0047) — see `BoneSpec.hinge`. Without the limits
      // the skeleton has nothing holding its shape and settles as a lump.
      const link = world.createImpulseJoint(
        spec.hinge
          ? RAPIER.JointData.revolute(anchorParent, anchorChild, spec.hinge.axis)
          : RAPIER.JointData.spherical(anchorParent, anchorChild),
        this.byName.get(spec.parent)!,
        this.byName.get(spec.name)!,
        true,
      );
      if (spec.hinge) {
        // Loud rather than silent: a revolute joint whose limits never got set
        // is a hinge that still swings freely, which holds *less* shape than
        // the ball joint it replaced while looking like it works.
        if (!(link instanceof RAPIER.RevoluteImpulseJoint)) {
          throw new Error(`Ragdoll: "${spec.name}" wanted a limited hinge but Rapier returned an unlimitable joint`);
        }
        link.setLimits(spec.hinge.min, spec.hinge.max);
      }
      // Bones that share a joint always overlap at it, so now that bones see
      // each other at all (`RAGDOLL_GROUPS`) their contact would be a
      // permanent shove pushing the skeleton apart from the inside.
      link.setContactsEnabled(false);
    }
  }

  get isActive(): boolean {
    return this.active;
  }

  /**
   * Snap every bone into the standing rest pose around `root`, hand it `velocity`
   * plus an `impulse` on the chest, and let physics take over.
   */
  activate(root: Vec3, velocity: Vec3, impulse: Vec3): void {
    for (const { spec, body, collider } of this.bones) {
      body.setTranslation(
        {
          x: root.x + spec.restCenter.x,
          y: root.y + spec.restCenter.y,
          z: root.z + spec.restCenter.z,
        },
        false,
      );
      body.setRotation(IDENTITY_QUAT, false);
      body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      body.setLinvel(velocity, true);
      body.setAngvel(ZERO, true);
      collider.setEnabled(true);
      // M6.1, found live ("a full Hit knocks nobody down"): Rapier derives a
      // body's mass from its colliders at the *next* step, so a bone that has
      // been sitting `Fixed` — which is every bone of every ragdoll in a
      // Match that has run for more than one tick — still reports
      // `mass() === 0` right here. `applyImpulse` divides the impulse by that
      // mass, so the shove below was silently discarded and the knockdown got
      // whatever `setLinvel` gave it and nothing else. That hid for a long
      // time because the impulse-carrying knockdowns (a dash into a wall, a
      // Spinner) also carry velocity of their own and tumbled anyway; a Hit
      // on a Character standing perfectly still carries none, so it just
      // stood there. Recomputing here is Rapier's own documented remedy.
      body.recomputeMassPropertiesFromColliders();
    }
    this.byName.get("chest")!.applyImpulse(impulse, true);
    this.active = true;
  }

  /** Shove the chest — a fresh Impact landing on a Character that is already down. */
  applyImpulse(impulse: Vec3): void {
    if (this.active) this.byName.get("chest")!.applyImpulse(impulse, true);
  }

  /** Freeze the ragdoll in place (the renderer stops drawing it once bones are empty). */
  deactivate(): void {
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
      max = Math.max(
        max,
        Math.hypot(v.x, v.y, v.z),
        Math.hypot(w.x, w.y, w.z) * Ragdoll.ANGULAR_SETTLE_WEIGHT,
      );
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
   * real launch to hand its own local ragdoll (ticket 08 follow-up): the
   * capsule's own velocity is zeroed the moment a Character goes down, so
   * without this a reconciled knockdown would always flop with zero velocity
   * on the bumped player's own screen, no matter how hard the hit was.
   */
  rootVelocity(): Vec3 {
    const v = this.byName.get("pelvis")!.linvel();
    return vec3(v.x, v.y, v.z);
  }

  /**
   * Shift the whole ragdoll so its pelvis sits at `root`, keeping the current
   * pose and bone velocities (ticket 05 reconciliation): the client's own
   * ragdoll flops on a stale trajectory once a Bump it never predicted has
   * landed, so each server snapshot re-anchors it to the authoritative pelvis
   * rather than letting the two drift apart for the length of the knockdown.
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

  /** Per-bone world transforms in {@link RAGDOLL_BONES} order. */
  readBones(): BoneSnapshot[] {
    return this.bones.map(({ body }) => {
      const t = body.translation();
      const r = body.rotation();
      return { position: vec3(t.x, t.y, t.z), rotation: { x: r.x, y: r.y, z: r.z, w: r.w } };
    });
  }

  /** Remove every bone body (and its joints/collider) from the world (ticket 01: `removeCharacter`). */
  dispose(): void {
    for (const { body } of this.bones) this.world.removeRigidBody(body);
  }
}
