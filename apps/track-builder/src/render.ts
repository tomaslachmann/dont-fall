import {
  segmentOrientation,
  type Box,
  type Checkpoint,
  type FinishZone,
  type LaunchPadConfig,
  type Module,
  type PropConfig,
  type Segment,
  type SpeedPadConfig,
  type SpinnerConfig,
  type VolumeConfig,
} from "@dont-fall/shared";
import * as THREE from "three";

const STATIC_COLOR = 0x3a4a5c;
const SPINNER_COLOR = 0xd9534f;
const PROP_BOX_COLOR = 0xd9a441;
const PROP_BALL_COLOR = 0x4aa8d9;
const CHECKPOINT_COLOR = 0x4ade80;
const SPEED_PAD_COLOR = 0xfacc15;
const LAUNCH_PAD_COLOR = 0x38bdf8;
const VOLUME_COLOR = 0xa78bfa;
const FINISH_ZONE_COLOR = 0xffd166;

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
  const { center, halfExtents } = checkpoint.trigger;
  const geo = new THREE.BoxGeometry(halfExtents.x * 2, halfExtents.y * 2, halfExtents.z * 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: CHECKPOINT_COLOR, wireframe: true }));
  mesh.position.set(center.x, center.y, center.z);
  group.add(mesh);
};

/**
 * A Finish Zone's trigger (M4 ticket 02) — the same wireframe-box treatment
 * every other trigger marker here gets, in the same colour the game itself
 * draws the Zone, so what an author places in the builder is recognisably
 * the thing players run at.
 */
const addFinishZone = (group: THREE.Group, finishZone: FinishZone): void => {
  const { center, halfExtents } = finishZone.trigger;
  const geo = new THREE.BoxGeometry(halfExtents.x * 2, halfExtents.y * 2, halfExtents.z * 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: FINISH_ZONE_COLOR, wireframe: true }));
  mesh.position.set(center.x, center.y, center.z);
  group.add(mesh);
};

/**
 * M3.7 ticket 01 (code review): a speed/slow pad's `trigger` had no visual
 * marker at all — a track designer placing the `speed-pad`/`slow-pad`
 * Modules saw only floor geometry, with no way to see (or debug a custom
 * Module whose trigger doesn't match its visible footprint) where the pad
 * actually fires. Mirrors `addCheckpoint`'s own wireframe-box treatment.
 */
const addSpeedPad = (group: THREE.Group, speedPad: SpeedPadConfig): void => {
  const { center, halfExtents } = speedPad.trigger;
  const geo = new THREE.BoxGeometry(halfExtents.x * 2, halfExtents.y * 2, halfExtents.z * 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: SPEED_PAD_COLOR, wireframe: true }));
  mesh.position.set(center.x, center.y, center.z);
  group.add(mesh);
};

/**
 * Same wireframe-box treatment as `addSpeedPad` (M3.7 ticket 02), plus an
 * arrow along the pad's own authored launch direction — unlike a speed pad
 * (which has no direction of its own to show), a launch pad's `velocity`
 * vector is exactly the one thing a track designer needs to see to place it
 * correctly, and a plain box alone can't convey it.
 */
const addLaunchPad = (group: THREE.Group, launchPad: LaunchPadConfig): void => {
  const { center, halfExtents } = launchPad.trigger;
  const geo = new THREE.BoxGeometry(halfExtents.x * 2, halfExtents.y * 2, halfExtents.z * 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: LAUNCH_PAD_COLOR, wireframe: true }));
  mesh.position.set(center.x, center.y, center.z);
  group.add(mesh);

  const { x, y, z } = launchPad.velocity;
  const length = Math.hypot(x, y, z);
  if (length > 0) {
    const direction = new THREE.Vector3(x, y, z).normalize();
    const origin = new THREE.Vector3(center.x, center.y, center.z);
    const arrow = new THREE.ArrowHelper(direction, origin, Math.min(length / 4, 4), LAUNCH_PAD_COLOR, 0.5, 0.3);
    group.add(arrow);
  }
};

/**
 * A Volume's `bounds`, wireframe, plus an arrow along `force` (M3.7 ticket
 * 04) — same "the region alone doesn't say what it does" reasoning as
 * `addLaunchPad`'s own arrow, and the same wireframe-box treatment as every
 * other trigger marker here. A different colour from a launch pad's own
 * arrow-bearing marker: a Volume never latches (CONTEXT.md's own avoid-list
 * for the word "trigger"), so it reads visually distinct at a glance.
 */
const addVolume = (group: THREE.Group, volume: VolumeConfig): void => {
  const { center, halfExtents } = volume.bounds;
  const geo = new THREE.BoxGeometry(halfExtents.x * 2, halfExtents.y * 2, halfExtents.z * 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: VOLUME_COLOR, wireframe: true }));
  mesh.position.set(center.x, center.y, center.z);
  group.add(mesh);

  const { x, y, z } = volume.force;
  const length = Math.hypot(x, y, z);
  if (length > 0) {
    const direction = new THREE.Vector3(x, y, z).normalize();
    const origin = new THREE.Vector3(center.x, center.y, center.z);
    const arrow = new THREE.ArrowHelper(direction, origin, Math.min(length / 8, 4), VOLUME_COLOR, 0.5, 0.3);
    group.add(arrow);
  }
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
  if (module.finishZone) addFinishZone(group, module.finishZone);
  for (const speedPad of module.speedPads ?? []) addSpeedPad(group, speedPad);
  for (const launchPad of module.launchPads ?? []) addLaunchPad(group, launchPad);
  for (const volume of module.volumes ?? []) addVolume(group, volume);
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
 * Frees every Mesh/Line's geometry/material under `group` (code review,
 * ticket 08) — `buildModuleGroup` allocates a fresh `BoxGeometry`/
 * `MeshStandardMaterial` per static/prop/spinner/checkpoint/pad, so a
 * discarded Group leaks GPU buffers if `setTrack` (the whole-Track overview,
 * called on every edit now, not just append) doesn't dispose the previous
 * one before replacing it. `THREE.Line` alongside `THREE.Mesh` (M3.7 ticket
 * 02, code review): a launch pad's `ArrowHelper` is a Group containing both
 * a Line (its shaft) and a Mesh (its head) — checking only `Mesh` silently
 * leaked the shaft's own geometry/material every time a launch pad's marker
 * was rebuilt.
 */
export const disposeGroup = (group: THREE.Object3D): void => {
  group.traverse((node) => {
    if (!(node instanceof THREE.Mesh) && !(node instanceof THREE.Line)) return;
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
