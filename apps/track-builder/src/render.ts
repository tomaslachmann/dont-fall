import { segmentOrientation, type Box, type Checkpoint, type Module, type PropConfig, type Segment, type SpinnerConfig } from "@dont-fall/shared";
import * as THREE from "three";

const STATIC_COLOR = 0x3a4a5c;
const SPINNER_COLOR = 0xd9534f;
const PROP_BOX_COLOR = 0xd9a441;
const PROP_BALL_COLOR = 0x4aa8d9;
const CHECKPOINT_COLOR = 0x4ade80;

const addBox = (group: THREE.Group, box: Box, color: number): void => {
  const geo = new THREE.BoxGeometry(box.halfExtents.x * 2, box.halfExtents.y * 2, box.halfExtents.z * 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color }));
  mesh.position.set(box.center.x, box.center.y, box.center.z);
  group.add(mesh);
};

const addSpinner = (group: THREE.Group, spinner: SpinnerConfig): void => {
  const geo = new THREE.BoxGeometry(spinner.armLength * 2, spinner.halfHeight * 2, spinner.armRadius * 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: SPINNER_COLOR }));
  mesh.position.set(spinner.center.x, spinner.center.y, spinner.center.z);
  group.add(mesh);
};

const addProp = (group: THREE.Group, prop: PropConfig): void => {
  const geo =
    prop.shape.kind === "box"
      ? new THREE.BoxGeometry(prop.shape.halfExtents.x * 2, prop.shape.halfExtents.y * 2, prop.shape.halfExtents.z * 2)
      : new THREE.SphereGeometry(prop.shape.radius, 16, 12);
  const color = prop.shape.kind === "box" ? PROP_BOX_COLOR : PROP_BALL_COLOR;
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color }));
  mesh.position.set(prop.center.x, prop.center.y, prop.center.z);
  group.add(mesh);
};

const addCheckpoint = (group: THREE.Group, checkpoint: Checkpoint): void => {
  const { center, halfExtents } = checkpoint.volume;
  const geo = new THREE.BoxGeometry(halfExtents.x * 2, halfExtents.y * 2, halfExtents.z * 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: CHECKPOINT_COLOR, wireframe: true }));
  mesh.position.set(center.x, center.y, center.z);
  group.add(mesh);
};

/**
 * Builds a Three.js Group from one Module's local-space geometry — the single
 * mesh-building path shared by the palette preview (ticket 04's visual-preview
 * requirement) and the whole-Track overview (one Group per placed Segment,
 * translated to that Segment's position).
 */
export const buildModuleGroup = (module: Module): THREE.Group => {
  const group = new THREE.Group();
  for (const box of module.statics) addBox(group, box, STATIC_COLOR);
  for (const spinner of module.spinners ?? []) addSpinner(group, spinner);
  for (const prop of module.props ?? []) addProp(group, prop);
  if (module.checkpoint) addCheckpoint(group, module.checkpoint);
  return group;
};

/**
 * Applies a Segment's full placement (position + 3D orientation, ADR 0034)
 * to its Module group — the one place `viewport.ts` (the Track overview) and
 * `playtest.ts` (the local playtest scene) both do this, instead of each
 * duplicating `group.quaternion.set(...)` from `segmentOrientation` inline
 * (code review, ticket 01: the two copies would otherwise need to be kept in
 * sync by hand).
 */
export const applySegmentTransform = (group: THREE.Object3D, segment: Segment): void => {
  group.position.set(segment.position.x, segment.position.y, segment.position.z);
  const q = segmentOrientation(segment);
  group.quaternion.set(q.x, q.y, q.z, q.w);
};

/**
 * Frees every Mesh's geometry/material under `group` (code review, ticket 08)
 * — `buildModuleGroup` allocates a fresh `BoxGeometry`/`MeshStandardMaterial`
 * per static/prop/spinner/checkpoint, so a discarded Group leaks GPU buffers
 * if `setTrack` (the whole-Track overview, called on every edit now, not
 * just append) doesn't dispose the previous one before replacing it.
 */
export const disposeGroup = (group: THREE.Object3D): void => {
  group.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry.dispose();
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) material.dispose();
  });
};

/** Half the diagonal of `group`'s bounding box — used to frame a preview camera. */
export const boundingRadius = (group: THREE.Group): number => {
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const radius = size.length() / 2;
  return Number.isFinite(radius) && radius > 0 ? radius : 4;
};
