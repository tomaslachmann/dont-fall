import * as THREE from "three";
import { ConvexHull } from "three/addons/math/ConvexHull.js";
import type { AuthoredSpec, BodySpec } from "./blipRagdoll.js";

/**
 * The Blender-authored colliders (the user's export, 2026-09-20):
 * `blip_with_coliders.glb` is the BLIP rig plus fifteen mesh nodes named
 * `COL_<bone>`, one per spec bone, sitting at the scene root in model space
 * at the rest pose. This turns them into an {@link AuthoredSpec} — the same
 * skeleton, joints and masses as the base spec (v3), only the shapes
 * replaced — so the bench can knock it down beside the others.
 *
 * Measured against v3's hulls before wiring this in: the Blender shapes are
 * the same idea (a hull around each bone's own skin) inflated ~5–10% — the
 * user's own estimate, confirmed per bone at 2–7 cm a side. The inflation is
 * not needed (the build already wears Rapier's contact skin) and the head
 * still covers the crest, so it swallows both shoulders deeper than v3;
 * the rest-overlap filter in `createBlipRagdoll` is what keeps that from
 * throwing the arms.
 *
 * The exported meshes carry 600–10700 vertices each; Rapier only ever keeps
 * a hull's extreme points, so they are reduced through three's ConvexHull
 * here, once at load, instead of handing Rapier ten thousand points per
 * knockout.
 */

/** Where the export lives, relative to the public root. */
export const BLENDER_COLLIDER_MODEL = "models/blip_with_coliders.glb";

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

/** A hull point budget: enough for any silhouette here, cheap for the solver and for the saved sessions. */
const HULL_BUDGET = 256;

/**
 * The hull, held under {@link HULL_BUDGET} points. A smooth Blender shape's
 * true hull can carry every vertex (the pelvis: 768) — snapping the points to
 * a grid and hulling again drops the near-coplanar ones, coarsening only
 * until it fits. The first grid is 2 cm in GLB units, ~12 mm on screen.
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

/**
 * Builds the spec from a loaded (and UNSCALED) collider scene. Every base
 * bone must find its `COL_` mesh — a missing one is an authoring error worth
 * hearing about, not a bone to silently drop.
 */
export const specFromColliderScene = (scene: THREE.Object3D, base: AuthoredSpec): AuthoredSpec => {
  scene.updateMatrixWorld(true);
  const worldPoint = new THREE.Vector3();
  const bodies: BodySpec[] = base.bodies.map((body) => {
    // GLTFLoader strips the dots from node names, the spec keeps them.
    const name = `COL_${body.bone}`;
    const node = scene.getObjectByName(name.replace(/\./g, "")) ?? scene.getObjectByName(name);
    const mesh = node as THREE.Mesh | null;
    if (!mesh?.isMesh) throw new Error(`blender colliders: no "${name}" mesh in the scene`);

    const positions = mesh.geometry.getAttribute("position");
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < positions.count; i += 1) {
      points.push(worldPoint.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld).clone());
    }

    // Into the bone's own frame, where the spec's hull points live.
    const [tx, ty, tz] = body.restWorld.translation;
    const [qx, qy, qz, qw] = body.restWorld.rotation;
    const intoBone = new THREE.Quaternion(qx, qy, qz, qw).invert();
    const kept = hullPoints(points).map((p) => p.sub(new THREE.Vector3(tx, ty, tz)).applyQuaternion(intoBone));

    return {
      ...body,
      collider: {
        shape: "convexHull",
        points: kept.map((p) => [p.x, p.y, p.z] as [number, number, number]),
        mass: body.collider.mass,
        ...(body.collider.angularDamping !== undefined ? { angularDamping: body.collider.angularDamping } : {}),
      },
    };
  });

  return { bodies, joints: base.joints };
};
