import {
  ASSET_MODULE_DEFS,
  ASSET_PLACEMENT_MODULES,
  assetFileName,
  MODULE_LIBRARY,
  type Module,
} from "@dont-fall/shared";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/**
 * The Assets tab's fixed Module set (M8 ticket 05): exactly the registry's
 * asset Modules — user-uploadable GLBs are a content-pipeline milestone, not
 * a tab feature, so there is deliberately no file input behind this list.
 */
export const assetTabModuleIds = (): string[] => ASSET_MODULE_DEFS.map((def) => def.id);

/**
 * Every Module the builder may place (M8 ticket 05): the procedural
 * registry composed with the asset defs' placement halves. Placement,
 * chaining, Socket-snap and overlap all read Sockets and footprints — never
 * triangles — so asset entries need no bytes; anything that simulates
 * resolves the same ids against real geometry instead.
 */
export const builderLibrary = (): Record<string, Module> => ({ ...MODULE_LIBRARY, ...ASSET_PLACEMENT_MODULES });

/**
 * The builder half of the asset role filter (M8 ticket 05, ADR 0050) — a
 * deliberate duplicate of the client's `extractVisualRoot` in
 * `apps/client/src/render/assetVisuals.ts`: ~15 lines, too small for a
 * package and the wrong mandate for `@dont-fall/ui`. Each copy points at
 * its twin and each is pinned by its app's tests. `role` wins in both and
 * the file is fixed on disagreement, never a loader-side override.
 *
 * Dropped means detached, never hidden-and-kept. Nothing has been uploaded
 * to the GPU at parse time, so references are simply released (disposing
 * here would risk freeing materials the visual nodes share).
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
 * Parse one fetched asset file into its visual template (M8 ticket 05).
 * Detached from any scene — the viewport clones it once per placed Segment
 * and the tab clones it once per preview.
 */
export const parseAssetVisual = async (moduleId: string, bytes: Uint8Array): Promise<THREE.Group> => {
  // GLTFLoader reads the whole ArrayBuffer it is given, so it gets an exact
  // copy — never `bytes.buffer`, which may be a larger backing store the
  // view only covers part of. Four tiny files; the copy is noise.
  const exact = new Uint8Array(bytes.byteLength);
  exact.set(bytes);
  let scene: THREE.Group;
  try {
    scene = (await new GLTFLoader().parseAsync(exact.buffer, "")).scene;
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
 * Fetch every tab Module's visual template through the API (M8 ticket
 * 05, ADR 0050 as amended — fetched at tab open, never a builder-local
 * copy). `fetchBytes`/`baseUrl` are injected, not builder-hardcoded,
 * mirroring the client's own loader pattern through its own fetch. The URL
 * is derived from the id via the shared `assetFileName`, exactly like
 * `loadAssetLibrary` — the filename stem rule (ADR 0050) holds for every
 * loader, so a mismatch is impossible by construction in any of them.
 */
export const loadAssetVisuals = async (
  fetchBytes: (url: string) => Promise<Uint8Array>,
  baseUrl: string,
  moduleIds: string[] = assetTabModuleIds(),
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
