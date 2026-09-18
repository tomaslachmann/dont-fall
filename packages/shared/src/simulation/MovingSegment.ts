import RAPIER from "@dimforge/rapier3d-compat";
import type { Box } from "../math/box.js";
import { conjugateQuat, mulQuat } from "../math/quat.js";
import { addVec3, rotateVec3ByQuat, scaleVec3, subVec3, type Quat, type Vec3 } from "../math/vec3.js";
import { TICK_DT } from "../tuning/clock.js";
import { IMPACT_RAGDOLL_MIN, IMPACT_STAGGER_MIN } from "../tuning/knockdown.js";
import { MOVING_SEGMENT_IMPACT_SCALE } from "../tuning/world.js";
import { motionPose, type MotionPose, type SegmentMotion } from "../track/Motion.js";
import type { SolidShape } from "../track/asset.js";
import type { Hazard } from "../track/Module.js";
import type { SurfaceId } from "../track/Surface.js";
import { STATIC_GROUPS } from "./collisionGroups.js";

/**
 * One Moving Segment (CONTEXT.md, ADR 0061) as `resolveTrack` hands it to the
 * simulation: its collision in the Segment's own local (Module) frame, its
 * rest placement, and its Motion. Kept local rather than baked into world
 * space like a still Segment's, because the whole thing moves as one body.
 */
export interface MovingSegmentConfig {
  /** Index of the Segment in its Track — how the renderer and the builder find its visual. */
  segmentIndex: number;
  moduleId: string;
  /** The Segment's rest placement. */
  position: Vec3;
  orientation: Quat;
  /** The Segment's uniform scale (ADR 0062) — already baked into `boxes`/`trimeshes`; its Motion's translation still needs it. */
  scale: number;
  motion: SegmentMotion;
  boxes: { box: Box; surface: SurfaceId; conveyor?: Vec3 }[];
  trimeshes: { vertices: Vec3[]; indices: number[]; surface: SurfaceId; hazard?: Hazard; conveyor?: Vec3 }[];
  /**
   * Solid parts (ADR 0065), already scaled, in the Segment's local frame — when
   * the Asset has them they replace `trimeshes` entirely: a hollow trimesh on a
   * moving body traps whatever ends up inside it.
   */
  solids: { shape: SolidShape; position: Vec3; rotation: Quat; surface: SurfaceId; hazard?: Hazard; conveyor?: Vec3 }[];
}

/** One solid part as a Rapier collider description, or `null` for a degenerate hull. Shared with `Prop` (ADR 0095), which builds the same shapes on a dynamic body. */
export const solidColliderDesc = (shape: SolidShape): RAPIER.ColliderDesc | null => {
  switch (shape.type) {
    case "ball":
      return RAPIER.ColliderDesc.ball(shape.radius);
    case "capsule":
      return RAPIER.ColliderDesc.capsule(shape.halfHeight, shape.radius);
    case "cylinder":
      return RAPIER.ColliderDesc.cylinder(shape.halfHeight, shape.radius);
    case "box":
      return RAPIER.ColliderDesc.cuboid(shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z);
    case "hull":
      return RAPIER.ColliderDesc.convexHull(new Float32Array(shape.points.flatMap((p) => [p.x, p.y, p.z])));
  }
};

/**
 * The Moving Segment's world pose at `tick` (fractional for rendering): the
 * Motion's local pose, then the Segment's placement — so a rest-local point
 * `p` is at `orientation·(motion.rotation·p + motion.position) + position`.
 */
export const movingSegmentPose = (
  config: Pick<MovingSegmentConfig, "position" | "orientation" | "motion"> & { scale?: number },
  tick: number,
): MotionPose => {
  const local = motionPose(config.motion, tick);
  return {
    rotation: mulQuat(config.orientation, local.rotation),
    position: addVec3(rotateVec3ByQuat(scaleVec3(local.position, config.scale ?? 1), config.orientation), config.position),
  };
};

/**
 * The Impact a Moving Segment deals a Character it closes on at
 * `closingSpeed` (units/s) — the one mapping the simulation delivers and the
 * Track builder's tint draws (ADR 0061), so the two cannot drift apart.
 */
export const movingSegmentImpactMagnitude = (closingSpeed: number): number =>
  Math.max(0, closingSpeed) * MOVING_SEGMENT_IMPACT_SCALE;

export type ImpactOutcome = "none" | "stagger" | "ragdoll";

/** What an Impact of `magnitude` does to a Character (ADR 0006's thresholds). */
export const impactOutcome = (magnitude: number): ImpactOutcome =>
  magnitude >= IMPACT_RAGDOLL_MIN ? "ragdoll" : magnitude >= IMPACT_STAGGER_MIN ? "stagger" : "none";

/** Closing speeds (units/s) from which a Moving Segment staggers, and knocks down, a Character standing in its way. */
export const MOVING_SEGMENT_STAGGER_SPEED = IMPACT_STAGGER_MIN / MOVING_SEGMENT_IMPACT_SCALE;
export const MOVING_SEGMENT_RAGDOLL_SPEED = IMPACT_RAGDOLL_MIN / MOVING_SEGMENT_IMPACT_SCALE;

/**
 * A rigid body's motion over the tick from `tick` to `tick + 1`, as a twist:
 * the velocity of `origin` and an angular velocity, so any world point `p`
 * moves at `linear + angular × (p − origin)` — how the builder's tint shades a
 * whole mesh from three uniforms. First-order in the per-tick rotation, which
 * at 30 Hz is well inside what a colour band can show.
 */
export const motionTwist = (poseAt: (tick: number) => MotionPose, tick: number): { origin: Vec3; linear: Vec3; angular: Vec3 } => {
  const now = poseAt(tick);
  const next = poseAt(tick + 1);
  const delta = mulQuat(next.rotation, conjugateQuat(now.rotation));
  const w = Math.max(-1, Math.min(1, delta.w));
  const sign = w < 0 ? -1 : 1; // the short way round
  const angle = 2 * Math.acos(Math.abs(w));
  const sinHalf = Math.sqrt(Math.max(0, 1 - w * w));
  const axis = sinHalf > 1e-9 ? { x: (delta.x * sign) / sinHalf, y: (delta.y * sign) / sinHalf, z: (delta.z * sign) / sinHalf } : { x: 0, y: 0, z: 0 };
  return {
    origin: now.position,
    linear: scaleVec3(subVec3(next.position, now.position), 1 / TICK_DT),
    angular: scaleVec3(axis, angle / TICK_DT),
  };
};

/**
 * A Moving Segment's kinematic body (ADR 0061): every collider of the
 * Segment on one position-based kinematic body, posed each tick from the
 * pure {@link movingSegmentPose}, exactly the way the M1 Spinner is — so a
 * server and a predicting client that agree on the Tick agree on the pose
 * without it ever being sent. Trimeshes on a kinematic body amend ADR 0050's
 * "statics only".
 */
export class MovingSegment {
  readonly config: MovingSegmentConfig;
  readonly colliders: { collider: RAPIER.Collider; surface: SurfaceId; hazard?: Hazard; conveyor?: Vec3 }[] = [];
  /** Handles of {@link colliders} — what a Ride's carry sweep ignores. */
  readonly colliderHandles = new Set<number>();
  private readonly body: RAPIER.RigidBody;

  constructor(world: RAPIER.World, config: MovingSegmentConfig, tick: number) {
    this.config = config;
    const pose = movingSegmentPose(config, tick);
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(pose.position.x, pose.position.y, pose.position.z)
        .setRotation(pose.rotation),
    );
    for (const { box, surface, conveyor } of config.boxes) {
      const collider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(box.halfExtents.x, box.halfExtents.y, box.halfExtents.z)
          .setTranslation(box.center.x, box.center.y, box.center.z)
          .setCollisionGroups(STATIC_GROUPS),
        this.body,
      );
      this.colliders.push({ collider, surface, ...(conveyor === undefined ? {} : { conveyor }) });
    }
    for (const part of config.solids) {
      const desc = solidColliderDesc(part.shape);
      if (!desc) throw new Error(`Moving Segment "${config.moduleId}": a degenerate ${part.shape.type} solid part`);
      const collider = world.createCollider(
        desc
          .setTranslation(part.position.x, part.position.y, part.position.z)
          .setRotation(part.rotation)
          .setCollisionGroups(STATIC_GROUPS),
        this.body,
      );
      this.colliders.push({
        collider,
        surface: part.surface,
        ...(part.hazard === undefined ? {} : { hazard: part.hazard }),
        ...(part.conveyor === undefined ? {} : { conveyor: part.conveyor }),
      });
    }
    for (const mesh of config.trimeshes) {
      // ORIENTED for the same reason as a still asset trimesh (see
      // `RapierSimulation`'s constructor): winding is verified outward per file.
      const collider = world.createCollider(
        RAPIER.ColliderDesc.trimesh(
          new Float32Array(mesh.vertices.flatMap((v) => [v.x, v.y, v.z])),
          new Uint32Array(mesh.indices),
          RAPIER.TriMeshFlags.ORIENTED,
        ).setCollisionGroups(STATIC_GROUPS),
        this.body,
      );
      this.colliders.push({
        collider,
        surface: mesh.surface,
        ...(mesh.hazard === undefined ? {} : { hazard: mesh.hazard }),
        ...(mesh.conveyor === undefined ? {} : { conveyor: mesh.conveyor }),
      });
    }
    for (const { collider } of this.colliders) this.colliderHandles.add(collider.handle);
  }

  /**
   * Hold the body still while the Characters sweep (ADR 0061). Rapier's
   * character controller carries a capsule standing on a *kinematic* body by
   * that body's velocity ("kinematic friction") — but only on the ticks its
   * own sweep happens to register the contact, so it carries some ticks and
   * not others, and on top of a Ride it carries twice. A fixed body has no
   * velocity to carry by, leaving the Ride the one authority.
   */
  holdForSweeps(): void {
    this.body.setBodyType(RAPIER.RigidBodyType.Fixed, false);
  }

  /**
   * Queue the pose for simulation tick `tick`, applied at the next
   * `world.step()` — back as a kinematic body, so the step still gives it the
   * velocity a Prop or a ragdoll it touches needs.
   */
  tick(tick: number): void {
    const pose = movingSegmentPose(this.config, tick);
    this.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    this.body.setNextKinematicTranslation(pose.position);
    this.body.setNextKinematicRotation(pose.rotation);
  }

  /**
   * Put the body at `tick`'s pose immediately — for a jump in the Tick (a
   * client's reconcile replay, ADR 0027), so the first replayed tick sweeps
   * against where the Segment really is rather than where it was.
   */
  place(tick: number): void {
    const pose = movingSegmentPose(this.config, tick);
    this.body.setTranslation(pose.position, false);
    this.body.setRotation(pose.rotation, false);
  }

  /** The body's current world pose, as Rapier holds it. */
  get pose(): MotionPose {
    const t = this.body.translation();
    const r = this.body.rotation();
    return { position: { x: t.x, y: t.y, z: t.z }, rotation: { x: r.x, y: r.y, z: r.z, w: r.w } };
  }
}
