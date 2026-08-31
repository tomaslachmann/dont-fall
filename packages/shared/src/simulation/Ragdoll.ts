import RAPIER from "@dimforge/rapier3d-compat";
import { IDENTITY_QUAT, type Quat } from "../math/quat.js";
import { vec3, type Vec3 } from "../math/vec3.js";
import { RAGDOLL_GROUPS } from "./collisionGroups.js";
import { jointRestPoint, RAGDOLL_BONES, type BoneSpec } from "./ragdollSkeleton.js";

/** One bone's world transform, for the snapshot / renderer. Ordered as {@link RAGDOLL_BONES}. */
export interface BoneSnapshot {
  position: Vec3;
  rotation: Quat;
}

const ZERO = { x: 0, y: 0, z: 0 };
/** Bodies are parked far below the world while the ragdoll is inactive. */
const PARK_OFFSET_Y = -1000;

interface Bone {
  spec: BoneSpec;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

/**
 * The Character's articulated ragdoll: 11 dynamic bones joined by spherical
 * joints (ADR 0006, ticket 05). Built once and parked; {@link activate} snaps it
 * into the standing pose and lets physics take over, {@link deactivate} freezes
 * and hides it. `SimState` never holds any of these handles (ADR 0009).
 */
export class Ragdoll {
  private readonly bones: Bone[] = [];
  private readonly byName = new Map<string, RAPIER.RigidBody>();
  private active = false;

  constructor(world: RAPIER.World) {
    for (const spec of RAGDOLL_BONES) {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(spec.restCenter.x, spec.restCenter.y + PARK_OFFSET_Y, spec.restCenter.z)
          .setAngularDamping(3)
          .setLinearDamping(0.12)
          .setCanSleep(false),
      );
      const collider = world.createCollider(
        RAPIER.ColliderDesc.capsule(spec.halfHeight, spec.radius)
          .setMass(spec.mass)
          .setFriction(0.9)
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
      world.createImpulseJoint(
        RAPIER.JointData.spherical(anchorParent, anchorChild),
        this.byName.get(spec.parent)!,
        this.byName.get(spec.name)!,
        true,
      );
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
    }
    this.byName.get("chest")!.applyImpulse(impulse, true);
    this.active = true;
  }

  /** Freeze and hide the ragdoll. */
  deactivate(): void {
    for (const { body, collider } of this.bones) {
      collider.setEnabled(false);
      body.setLinvel(ZERO, false);
      body.setAngvel(ZERO, false);
      body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
    }
    this.active = false;
  }

  /** Fastest bone speed (units/s), linear or scaled angular — for the settled check. */
  maxSpeed(): number {
    let max = 0;
    for (const { body } of this.bones) {
      const v = body.linvel();
      const w = body.angvel();
      max = Math.max(
        max,
        Math.hypot(v.x, v.y, v.z),
        Math.hypot(w.x, w.y, w.z) * 0.3,
      );
    }
    return max;
  }

  /** The pelvis position — the point the camera follows while ragdolling. */
  rootPosition(): Vec3 {
    const t = this.byName.get("pelvis")!.translation();
    return vec3(t.x, t.y, t.z);
  }

  /** Per-bone world transforms in {@link RAGDOLL_BONES} order. */
  readBones(): BoneSnapshot[] {
    return this.bones.map(({ body }) => {
      const t = body.translation();
      const r = body.rotation();
      return { position: vec3(t.x, t.y, t.z), rotation: { x: r.x, y: r.y, z: r.z, w: r.w } };
    });
  }
}
