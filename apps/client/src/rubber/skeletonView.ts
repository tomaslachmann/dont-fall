import type { BoneSnapshot, BoneSpec } from "@dont-fall/shared";
import * as THREE from "three";
import { ConvexGeometry } from "three/addons/geometries/ConvexGeometry.js";

/**
 * Draws a ragdoll's actual colliders, so a skeleton can be looked at rather
 * than reasoned about (the user's ask, 2026-09-20, after a knockout came out
 * wrong on a new skeleton).
 *
 * One wireframe per bone, in world space — deliberately **not** parented to
 * the model, because the whole question this answers is whether the physics
 * bones are where the drawn body is. Parenting them would hide exactly the
 * mismatch worth seeing: the game's skeleton has a chest of radius 0.18
 * inside a bean whose drawn half-width is 0.889.
 *
 * The shapes match what `Ragdoll` builds: a capsule, or a box of the same
 * outer size where {@link BoneSpec.depth} makes the bone oval.
 *
 * Drawn as wireframe meshes and not with `EdgesGeometry`, which keeps only
 * the edges where two faces meet sharply enough: a smooth capsule has none of
 * those, so it came out completely invisible.
 */

/**
 * How sharply two faces must meet for the edge between them to be drawn on a
 * hull. A hull wrapped around fifty scattered surface points is finely
 * faceted, so a low threshold keeps nearly every triangle and the shape
 * disappears into its own mesh; this keeps the creases that describe it.
 */
const HULL_EDGE_DEGREES = 15;

/** Names of bones whose hull would not build, collected by the last {@link geometryFor} pass. */
const hullFailures: string[] = [];

/** Bones that carry the body, so they read apart from the limbs. `body` is what an authored rig calls the chest. */
const TORSO = new Set(["pelvis", "chest", "body", "head"]);

/**
 * Drawn to match what `Ragdoll` builds, shape for shape. A box is drawn as an
 * ellipsoid, not as the cuboid it starts from: the collider is rounded to
 * within a hair of its thinnest axis, so what is actually in the world is a
 * flattened egg, and drawing the brick would show a shape that is not there.
 */
/** A box around a hull's points, for when the hull itself cannot be built. */
const hullBounds = (points: readonly { x: number; y: number; z: number }[]): THREE.BufferGeometry => {
  const box = new THREE.Box3().makeEmpty();
  const point = new THREE.Vector3();
  for (const p of points) box.expandByPoint(point.set(p.x, p.y, p.z));
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  return new THREE.BoxGeometry(size.x, size.y, size.z).translate(centre.x, centre.y, centre.z);
};

const geometryFor = (spec: BoneSpec): THREE.BufferGeometry => {
  if (spec.shape === "hull" && spec.hullPoints && spec.hullPoints.length >= 4) {
    // The same wrap Rapier makes, drawn: three.js builds the hull from the
    // points too, so what is shown is what is there.
    try {
      return new ConvexGeometry(spec.hullPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z)));
    } catch (error) {
      // One hull that will not wrap used to take the whole view down with it,
      // and nothing at all was drawn. A box around its points says "this bone
      // is here, and its hull is the problem".
      console.warn(`skeleton view: no hull for "${spec.name}"`, error);
      hullFailures.push(spec.name);
      return hullBounds(spec.hullPoints);
    }
  }
  if ((spec.shape ?? "capsule") === "capsule") {
    return new THREE.CapsuleGeometry(spec.radius, spec.halfHeight * 2, 4, 12);
  }
  const depth = spec.depth ?? spec.radius;
  const roundness = Math.min(1, Math.max(0, spec.roundness ?? 1));
  // Rounded all the way is an ellipsoid; sharp is the box itself. In between,
  // a box whose corners are pulled in — drawn as a blend of the two, which is
  // near enough to see what the collider is doing.
  if (roundness >= 0.98) {
    return new THREE.SphereGeometry(1, 16, 10).scale(spec.radius, spec.halfHeight, depth);
  }
  const box = new THREE.BoxGeometry(spec.radius * 2, spec.halfHeight * 2, depth * 2, 2, 2, 2);
  if (roundness > 0) {
    const position = box.attributes.position!;
    const sphere = new THREE.Vector3();
    for (let i = 0; i < position.count; i += 1) {
      sphere.fromBufferAttribute(position, i);
      // Where this corner would sit if the shape were a full ellipsoid.
      const pulled = sphere
        .clone()
        .divide(new THREE.Vector3(spec.radius, spec.halfHeight, depth))
        .normalize()
        .multiply(new THREE.Vector3(spec.radius, spec.halfHeight, depth));
      sphere.lerp(pulled, roundness);
      position.setXYZ(i, sphere.x, sphere.y, sphere.z);
    }
    position.needsUpdate = true;
  }
  return box;
};

export class SkeletonView {
  private readonly group = new THREE.Group();
  private shapes: THREE.Object3D[] = [];
  private builtFor: readonly BoneSpec[] | null = null;

  constructor(scene: THREE.Scene) {
    this.group.visible = false;
    scene.add(this.group);
  }

  set visible(on: boolean) {
    this.group.visible = on;
  }

  /** How many shapes are on screen, and what could not be drawn — for saying so out loud. */
  get drawn(): { shapes: number; failed: number } {
    return { shapes: this.shapes.length, failed: this.failed };
  }

  private failed = 0;

  /** Rebuilds only when handed a different skeleton, so this costs nothing per frame. */
  private build(bones: readonly BoneSpec[]): void {
    for (const shape of this.shapes) {
      const drawn = shape as THREE.Mesh | THREE.LineSegments;
      drawn.geometry.dispose();
      (drawn.material as THREE.Material).dispose();
      this.group.remove(shape);
    }
    hullFailures.length = 0;
    this.shapes = bones.map((spec) => {
      const colour = TORSO.has(spec.name) ? 0xffd24a : 0x6fd3ff;
      const geometry = geometryFor(spec);
      // A hull is drawn as the edges of its faces, not as every triangle it
      // is made of: fifty points wrap into hundreds of triangles, and as a
      // full wireframe over a see-through body that is unreadable mush. A
      // hull has real flat faces, so an edge threshold finds them — which is
      // exactly what it could not do for a smooth capsule.
      const wire =
        spec.shape === "hull"
          ? new THREE.LineSegments(
              new THREE.EdgesGeometry(geometry, HULL_EDGE_DEGREES),
              new THREE.LineBasicMaterial({ color: colour, depthTest: false, transparent: true, opacity: 0.9 }),
            )
          : new THREE.Mesh(
              geometry,
              new THREE.MeshBasicMaterial({
                color: colour,
                wireframe: true,
                depthTest: false,
                transparent: true,
                opacity: 0.85,
              }),
            );
      wire.renderOrder = 999;
      this.group.add(wire);
      return wire;
    });
    this.failed = hullFailures.length;
    this.builtFor = bones;
  }

  /** Puts every wireframe where its bone is this frame. */
  update(bones: readonly BoneSpec[], pose: readonly BoneSnapshot[]): void {
    if (!this.group.visible) return;
    if (this.builtFor !== bones) this.build(bones);
    for (const [i, shape] of this.shapes.entries()) {
      const snapshot = pose[i];
      if (!snapshot) continue;
      shape.position.set(snapshot.position.x, snapshot.position.y, snapshot.position.z);
      shape.quaternion.set(snapshot.rotation.x, snapshot.rotation.y, snapshot.rotation.z, snapshot.rotation.w);
    }
  }

  /**
   * The skeleton in its authored rest pose, for looking at it against a
   * standing bean — what a knockout never shows, because by the time you see
   * it the body has already moved.
   */
  updateAtRest(bones: readonly BoneSpec[], origin: THREE.Vector3): void {
    if (!this.group.visible) return;
    if (this.builtFor !== bones) this.build(bones);
    for (const [i, shape] of this.shapes.entries()) {
      const spec = bones[i]!;
      shape.position.set(origin.x + spec.restCenter.x, origin.y + spec.restCenter.y, origin.z + spec.restCenter.z);
      const turn = spec.restRotation;
      if (turn) shape.quaternion.set(turn.x, turn.y, turn.z, turn.w);
      else shape.quaternion.identity();
    }
  }
}
