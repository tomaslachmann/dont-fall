import RAPIER from "@dimforge/rapier3d-compat";
import { IDENTITY_QUAT } from "../math/quat.js";
import { vec3, type Vec3 } from "../math/vec3.js";
import {
  RAGDOLL_ANGULAR_DAMPING,
  RAGDOLL_CONTACT_SKIN,
  RAGDOLL_FRICTION,
  RAGDOLL_LINEAR_DAMPING,
  RAGDOLL_SOLVER_ITERATIONS,
} from "../tuning/knockdown.js";
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
/**
 * The collider a bone wears, by {@link BoneSpec.shape}. A body is not all one
 * shape — a torso is closer to a box, a joint to a ball, a limb to a capsule
 * — so each bone says which it is, and `"capsule"` is what it has always been.
 *
 * A capsule reads `halfHeight` as its cylinder alone, with `radius` adding to
 * both ends, which is that shape's own convention. A box has no caps, so for
 * one of those all three of `radius`, `halfHeight` and `depth` are plain
 * half-extents; it is rounded to within a hair of its thinnest axis, which is
 * what makes a flattened one read as an egg rather than a brick.
 */
const shapeFor = (spec: BoneSpec): RAPIER.ColliderDesc => {
  if (spec.shape === "hull" && spec.hullPoints && spec.hullPoints.length >= 4) {
    const flat = new Float32Array(spec.hullPoints.length * 3);
    for (const [i, point] of spec.hullPoints.entries()) {
      flat[i * 3] = point.x;
      flat[i * 3 + 1] = point.y;
      flat[i * 3 + 2] = point.z;
    }
    const hull = RAPIER.ColliderDesc.convexHull(flat);
    // Rapier answers null for points it cannot wrap — degenerate, or too few.
    // A bone with no collider at all would fall through the world silently.
    if (hull) return hull;
  }
  if ((spec.shape ?? "capsule") === "capsule") return RAPIER.ColliderDesc.capsule(spec.halfHeight, spec.radius);
  const depth = spec.depth ?? spec.radius;
  const roundness = Math.min(1, Math.max(0, spec.roundness ?? 1));
  // Rounded to within a hair of the thinnest axis at most, so the box never
  // collapses to nothing in the direction it is being rounded from.
  const border = Math.min(spec.radius, spec.halfHeight, depth) * 0.95 * roundness;
  return border <= 0
    ? RAPIER.ColliderDesc.cuboid(spec.radius, spec.halfHeight, depth)
    : RAPIER.ColliderDesc.roundCuboid(spec.radius - border, spec.halfHeight - border, depth - border, border);
};

export class Ragdoll {
  private readonly world: RAPIER.World;
  private readonly bones: Bone[] = [];
  private readonly byName = new Map<string, RAPIER.RigidBody>();
  private active = false;

  /**
   * `specs` lets a caller try a different body without forking this class:
   * `apps/client/src/rubber` hands it a flattened torso to see how it
   * settles. The game always uses the default, so nothing here changes for a
   * Match until that experiment is settled.
   */
  constructor(world: RAPIER.World, specs: readonly BoneSpec[] = RAGDOLL_BONES) {
    this.world = world;
    for (const spec of specs) {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(spec.restCenter.x, spec.restCenter.y, spec.restCenter.z)
          .setAngularDamping(RAGDOLL_ANGULAR_DAMPING)
          .setLinearDamping(RAGDOLL_LINEAR_DAMPING)
          .setAdditionalSolverIterations(RAGDOLL_SOLVER_ITERATIONS) // ticket 08: survive a dash-crash into a Prop
          .setCanSleep(false),
      );
      const offset = spec.colliderOffset;
      const collider = world.createCollider(
        shapeFor(spec)
          .setTranslation(offset?.x ?? 0, offset?.y ?? 0, offset?.z ?? 0)
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

    for (const spec of specs) {
      if (!spec.parent) continue;
      const parentSpec = specs.find((b) => b.name === spec.parent)!;
      // A bone that carries its own collider offset is sitting on a rig
      // pivot, so that pivot is where it turns; anything else meets its
      // parent halfway between the two shapes, as it always has.
      const joint =
        spec.colliderOffset === undefined
          ? jointRestPoint(spec, parentSpec)
          : spec.restCenter;
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
      body.setRotation(spec.restRotation ?? IDENTITY_QUAT, false);
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

  /** Per-bone world transforms, in the order of the skeleton this was built from. */
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
