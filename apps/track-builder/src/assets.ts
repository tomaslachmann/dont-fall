import {
  ASSET_MODULE_DEFS,
  ASSET_PLACEMENT_MODULES,
  assetFileName,
  MODULE_LIBRARY,
  type AssetCategory,
  type Module,
} from "@dont-fall/shared";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";

/**
 * The Assets tab's fixed Module set (M8 ticket 05): exactly the registry's
 * asset Modules — user-uploadable GLBs are a content-pipeline milestone, not
 * a tab feature, so there is deliberately no file input behind this list.
 */
export const assetTabModuleIds = (): string[] => ASSET_MODULE_DEFS.map((def) => def.id);

/** Each tab Module's Asset category — which of the tab's groups lists it. */
export const assetCategoryById = (): Record<string, AssetCategory> =>
  Object.fromEntries(ASSET_MODULE_DEFS.map((def) => [def.id, def.category]));

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
 * Every asset file embeds its own copy of its pack's texture — 456 files over
 * ~6 distinct images — and each parse decodes a fresh 1024² bitmap and would
 * upload it to the GPU once per file (in the viewport's and the previews'
 * contexts both). Textures whose embedded image bytes and sampling match
 * resolve to one shared `THREE.Texture` for the session; a replaced
 * duplicate's decoded bitmap is released at once rather than left to GC.
 */
const sharedTextures = new Map<string, THREE.Texture>();

/** Two FNV-1a passes with different seeds — a content key, not a security hash. */
const contentKey = (bytes: Uint8Array): string => {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ bytes.length;
  for (let i = 0; i < bytes.length; i += 1) {
    a = Math.imul(a ^ bytes[i]!, 0x01000193);
    b = Math.imul(b ^ bytes[i]!, 0x5bd1e995);
  }
  return `${bytes.length}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
};

const shareTextures = async (gltf: GLTF): Promise<void> => {
  const { parser } = gltf;
  const slots: { material: THREE.Material; key: string; texture: THREE.Texture }[] = [];
  gltf.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const [key, value] of Object.entries(material)) {
        if ((value as THREE.Texture | null)?.isTexture) slots.push({ material, key, texture: value as THREE.Texture });
      }
    }
  });

  const keyByTexture = new Map<THREE.Texture, string | null>();
  for (const { texture } of slots) {
    if (keyByTexture.has(texture)) continue;
    // A texture the loader cloned without a glTF association (a non-zero
    // `texCoord`) can't be traced to its image, so it simply stays unshared.
    const textureIndex = parser.associations.get(texture)?.textures;
    const bufferView = textureIndex === undefined ? undefined : parser.json.images?.[parser.json.textures[textureIndex].source]?.bufferView;
    if (bufferView === undefined) {
      keyByTexture.set(texture, null);
      continue;
    }
    const image = new Uint8Array((await parser.getDependency("bufferView", bufferView)) as ArrayBuffer);
    const sampling = [texture.colorSpace, texture.channel, texture.flipY, texture.wrapS, texture.wrapT, texture.magFilter, texture.minFilter];
    keyByTexture.set(texture, `${contentKey(image)}|${sampling.join(",")}`);
  }

  const replaced = new Set<THREE.Texture>();
  for (const { material, key, texture } of slots) {
    const contentKeyOrNull = keyByTexture.get(texture);
    if (!contentKeyOrNull) continue;
    const shared = sharedTextures.get(contentKeyOrNull);
    if (!shared) {
      sharedTextures.set(contentKeyOrNull, texture);
      continue;
    }
    if (shared === texture) continue;
    (material as unknown as Record<string, unknown>)[key] = shared;
    material.needsUpdate = true;
    replaced.add(texture);
  }

  // Release a duplicate's bitmap only when nothing in this file still draws
  // from its image (clones share one `source`).
  const stillUsed = new Set(slots.map((slot) => (slot.material as unknown as Record<string, THREE.Texture>)[slot.key]!.source));
  for (const texture of replaced) {
    if (stillUsed.has(texture.source)) continue;
    (texture.image as { close?: () => void } | null)?.close?.();
    texture.dispose();
  }
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
    const gltf = await new GLTFLoader().parseAsync(exact.buffer, "");
    await shareTextures(gltf);
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

export const ASSET_LOAD_CONCURRENCY = 8;

/**
 * Fetch every tab Module's visual template through the API (M8 ticket
 * 05, ADR 0050 as amended — fetched at tab open, never a builder-local
 * copy). `fetchBytes`/`baseUrl` are injected, not builder-hardcoded,
 * mirroring the client's own loader pattern through its own fetch. The URL
 * is derived from the id via the shared `assetFileName`, exactly like
 * `loadAssetLibrary` — the filename stem rule (ADR 0050) holds for every
 * loader, so a mismatch is impossible by construction in any of them.
 *
 * Up to `ASSET_LOAD_CONCURRENCY` files load at once — one at a time was
 * ~1.8 s of tab-open wait for the 124-file asset set.
 */
export const loadAssetVisuals = async (
  fetchBytes: (url: string) => Promise<Uint8Array>,
  baseUrl: string,
  moduleIds: string[] = assetTabModuleIds(),
): Promise<Record<string, THREE.Group>> => {
  const loaded: THREE.Group[] = new Array(moduleIds.length);
  let next = 0;
  // One failure rejects the load; the other workers stop taking new files.
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && next < moduleIds.length) {
      const index = next++;
      const moduleId = moduleIds[index]!;
      const url = `${baseUrl}/${assetFileName(moduleId)}`;
      let bytes: Uint8Array;
      try {
        bytes = await fetchBytes(url);
      } catch (err) {
        failed = true;
        throw new Error(`asset "${moduleId}": could not fetch ${url}: ${(err as Error).message}`);
      }
      try {
        loaded[index] = await parseAssetVisual(moduleId, bytes);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(ASSET_LOAD_CONCURRENCY, moduleIds.length) }, worker));
  return Object.fromEntries(moduleIds.map((moduleId, index) => [moduleId, loaded[index]!]));
};

/** One file's outcome — the Assets tab settles each tile independently. */
export type AssetVisualResult = { ok: true; template: THREE.Group } | { ok: false; error: Error };

/**
 * The Assets tab's own loader: same fetch-then-parse pipe as
 * `loadAssetVisuals`, but per-file — each Module settles its tile the
 * moment its own bytes parse, and one bad file never fails the other 455.
 * Resolves once every file has settled either way; `onSettled` fires in
 * arrival order, never twice per id.
 */
export const loadAssetVisualsProgressive = async (
  fetchBytes: (url: string) => Promise<Uint8Array>,
  baseUrl: string,
  moduleIds: string[],
  onSettled: (moduleId: string, result: AssetVisualResult) => void,
): Promise<void> => {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < moduleIds.length) {
      const index = next++;
      const moduleId = moduleIds[index]!;
      const url = `${baseUrl}/${assetFileName(moduleId)}`;
      try {
        const bytes = await fetchBytes(url);
        onSettled(moduleId, { ok: true, template: await parseAssetVisual(moduleId, bytes) });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        onSettled(moduleId, { ok: false, error: new Error(`asset "${moduleId}": ${message}`) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(ASSET_LOAD_CONCURRENCY, moduleIds.length) }, worker));
};
