import RAPIER from "@dimforge/rapier3d-compat";
import { vec3, type Vec3 } from "../math/vec3.js";
import { CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS } from "../tuning.js";
import { CHARACTER_GROUPS } from "./collisionGroups.js";

/**
 * A stand-in for *another* player's Character in a client's local prediction
 * world (ADR 0012, ticket 04): a kinematic capsule positioned each tick
 * straight from the latest server snapshot, never simulated for its own
 * motion. It exists only so the local player's own predicted movement slides
 * against it instead of walking through — the same capsule shape and
 * collision group as a real {@link CharacterController}, but with no state
 * machine, no ragdoll, no input.
 *
 * Bump state changes are still resolved server-side only: a mirror carries no
 * `CharacterController`, so `RapierSimulation` never finds it in
 * `characterIdByHandle` and never applies an Impact to it.
 */
export class MirrorCharacter {
  readonly collider: RAPIER.Collider;
  private readonly body: RAPIER.RigidBody;
  private target: Vec3;

  constructor(world: RAPIER.World, at: Vec3) {
    this.target = { ...at };
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(at.x, at.y, at.z),
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS).setCollisionGroups(CHARACTER_GROUPS),
      this.body,
    );
  }

  /** Set where this mirror should be for the next `world.step()`. Applied by {@link step}. */
  moveTo(point: Vec3): void {
    this.target = { ...point };
  }

  /** Queue the kinematic move for the upcoming step. Called by `RapierSimulation.tick` before `world.step()`. */
  step(): void {
    this.body.setNextKinematicTranslation(this.target);
  }

  /** Current position (mostly for tests). */
  get position(): Vec3 {
    const t = this.body.translation();
    return vec3(t.x, t.y, t.z);
  }

  dispose(world: RAPIER.World): void {
    world.removeCollider(this.collider, false);
    world.removeRigidBody(this.body);
  }
}
