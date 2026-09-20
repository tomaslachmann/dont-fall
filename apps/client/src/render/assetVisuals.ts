import {
  assetFileName,
  segmentBody,
  segmentOrientation,
  segmentScale,
  type Module,
  type Quat,
  type SegmentColorId,
  type Track,
  type Vec3,
} from "@dont-fall/shared";
import { shareTextures, templateForPlacement, type SharedTextureCache } from "@dont-fall/render";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/**
 * The client half of the asset role filter (M8 ticket 03, ADR 0050): what the
 * eye gets. `GLTFLoader` surfaces each glTF node's `extras` on its
 * `userData`, so `role: collision` subtrees are found the same way the shared
 * reader finds them — but dropped here, never hidden-and-kept, while the
 * shared reader bakes them into trimeshes there.
 *
 * A deliberate duplicate of the track builder's own copy (ticket 05): ~15
 * lines, too small for a package and the wrong mandate for `@dont-fall/ui` —
 * each copy points at its twin, each pinned by its app's tests. `role` wins
 * in both and the file is fixed on disagreement, never a loader-side
 * override.
 */
export const extractVisualRoot = (scene: THREE.Object3D): THREE.Group => {
  const condemned: THREE.Object3D[] = [];
  scene.traverse((object) => {
    if (object.userData.role === "collision") condemned.push(object);
  });
  // Detach after the traversal, not during it — removing children while
  // walking would skip siblings. A condemned child of a condemned parent
  // leaves with it; re-removing it below is a harmless no-op.
  for (const object of condemned) object.parent?.remove(object);
  const root = new THREE.Group();
  for (const child of [...scene.children]) root.add(child);
  if (!hasMesh(root)) throw new Error('asset: parsed GLB keeps no visual mesh (every node is role "collision"?)');
  return root;
};

const hasMesh = (root: THREE.Object3D): boolean => {
  let found = false;
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) found = true;
  });
  return found;
};

/**
 * Every Asset file's textures, shared across files for the page session
 * (memory-footprint ticket 02): the pack texture is decoded once and uploaded
 * once per Stage, however many files embed it. A Stage's scene sweep may
 * still dispose these on a Track swap; that frees only the GPU copy, and the
 * next Stage, with its own renderer, uploads them again.
 */
const sharedTextures: SharedTextureCache = new Map();

/**
 * Parse one fetched asset file into its visual template (M8 ticket 03).
 * Detached from any scene — `buildAssetVisuals` clones it once per placed
 * Segment. Dropped collision geometry is released by reference: nothing has
 * been uploaded to the GPU at parse time, so there is nothing to dispose —
 * and disposing here would risk freeing materials the visual nodes share.
 */
export const parseAssetVisual = async (moduleId: string, bytes: Uint8Array): Promise<THREE.Group> => {
  // GLTFLoader reads the whole ArrayBuffer it is given, so it gets an exact
  // copy — never `bytes.buffer`, which may be a larger backing store the
  // view only covers part of. Four tiny files; the copy is noise.
  const exact = new Uint8Array(bytes.byteLength);
  exact.set(bytes);
  let scene: THREE.Group;
  try {
    const gltf = await new GLTFLoader().parseAsync(exact.buffer, "");
    await shareTextures(gltf, sharedTextures);
    scene = gltf.scene;
  } catch (err) {
    throw new Error(`asset "${moduleId}": visual parse failed: ${(err as Error).message}`);
  }
  try {
    return extractVisualRoot(scene);
  } catch (err) {
    throw new Error(`asset "${moduleId}": ${(err as Error).message}`);
  }
};

/**
 * Fetch every asset Module's visual template through the API (M8 ticket
 * 03, ADR 0050 as amended — fetched at track load, never bundled).
 * `fetchBytes`/`baseUrl` are injected, not game-hardcoded: ticket 05 reuses
 * this pattern through its own fetch. The URL is derived from the id via the
 * shared `assetFileName`, exactly like `loadAssetLibrary` — the filename stem
 * rule (ADR 0050) holds for both loaders, so a mismatch is impossible by
 * construction in either. Fails the whole load on the first bad file, naming
 * it — same discipline as the collision half.
 */
export const loadAssetVisuals = async (
  fetchBytes: (url: string) => Promise<Uint8Array>,
  baseUrl: string,
  moduleIds: string[],
): Promise<Record<string, THREE.Group>> => {
  const templates: Record<string, THREE.Group> = {};
  for (const moduleId of moduleIds) {
    const url = `${baseUrl}/${assetFileName(moduleId)}`;
    let bytes: Uint8Array;
    try {
      bytes = await fetchBytes(url);
    } catch (err) {
      throw new Error(`asset "${moduleId}": could not fetch ${url}: ${(err as Error).message}`);
    }
    templates[moduleId] = await parseAssetVisual(moduleId, bytes);
  }
  return templates;
};

export interface AssetVisualPlacement {
  moduleId: string;
  /** Which Segment this instance draws — what lets a per-Segment effect (a Spring's squash, ADR 0069) find it. */
  segmentIndex: number;
  /** The Segment's paint, when it has one — the instance draws what the paint wears: its authored file, or the placed file tinted flat. */
  color?: SegmentColorId;
  /** The Segment's own origin — the same vector `resolveTrack` translates collision by. */
  position: Vec3;
  /** The Segment's full orientation — the same `segmentOrientation` `resolveTrack` rotates collision by. */
  orientation: Quat;
  /** The Segment's uniform scale (ADR 0062) — the same `segmentScale` `resolveTrack` scales collision by; 1 when absent. */
  scale?: number;
}

/**
 * One visual instance per placed asset Segment (M8 ticket 03), positioned and
 * rotated exactly as the Segment places its collision: same origin, same
 * transform, never separate positioning code — both read the Segment through
 * the shared `segmentOrientation`. Only asset Modules place visuals (the
 * registry, not the loader, decides which is which — ADR 0050); `resolveTrack`
 * owns the unknown-Module error and throws there first in every flow that
 * calls this, so unknown ids are simply not placements here.
 */
export const assetPlacements = (track: Track, library: Record<string, Module>): AssetVisualPlacement[] => {
  const placements: AssetVisualPlacement[] = [];
  for (const [segmentIndex, segment] of track.entries()) {
    const module = library[segment.moduleId];
    if (module?.asset === undefined) continue;
    // A Moving Segment's visual moves with it (ADR 0061) and a Prop's is drawn
    // from its replicated pose (ADR 0095) — the stage builds both itself. The
    // body `resolveTrack` gave it, so an Asset with no solid parts, which
    // cannot be a Prop and stays where it was put, is still drawn here.
    if (segmentBody(segment, module) !== "still") continue;
    placements.push({
      moduleId: segment.moduleId,
      segmentIndex,
      position: segment.position,
      orientation: segmentOrientation(segment),
      ...(segmentScale(segment) !== 1 ? { scale: segmentScale(segment) } : {}),
      ...(segment.color === undefined ? {} : { color: segment.color }),
    });
  }
  return placements;
};

/**
 * Clone one visual instance per placement under a single Group (M8 ticket 03).
 * Clones share the template's geometry/materials (three.js `clone` shares,
 * never duplicates), so the cached templates cover a Track of any length
 * with no per-Segment upload — one tinted variant per (file, paint) for new
 * hues, shared by every placement wearing it (authored hues draw their own
 * file). The Group joins the scene in
 * `createStage`, which frees it with the existing scene-graph sweep on Track
 * reload (M4 ticket 01's discipline); the templates stay cached outside the
 * scene for the session.
 */
export const buildAssetVisuals = (
  templates: Record<string, THREE.Group>,
  placements: AssetVisualPlacement[],
): THREE.Group => {
  const group = new THREE.Group();
  for (const placement of placements) {
    const template = templateForPlacement(templates, placement.moduleId, placement.color);
    const instance = template.clone(true);
    instance.position.set(placement.position.x, placement.position.y, placement.position.z);
    instance.quaternion.set(
      placement.orientation.x,
      placement.orientation.y,
      placement.orientation.z,
      placement.orientation.w,
    );
    instance.scale.setScalar(placement.scale ?? 1);
    group.add(instance);
  }
  return group;
};
