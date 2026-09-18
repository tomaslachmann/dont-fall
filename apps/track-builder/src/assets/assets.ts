import {
  ASSET_MODULE_DEFS,
  ASSET_PLACEMENT_MODULES,
  assetFileName,
  attachAssetGeometry,
  deckPlanOf,
  loadAssetModule,
  type AssetCategory,
  type DeckPlan,
  type Module,
} from "@dont-fall/shared";
import { shareTextures, type SharedTextureCache } from "@dont-fall/render";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

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
 * Every Module the builder may place (M8 ticket 05): the asset defs'
 * placement halves, and nothing procedural (ADR 0078). Placement,
 * chaining, Socket-snap and overlap all read Sockets and footprints — never
 * triangles — so asset entries need no bytes; anything that simulates
 * resolves the same ids against real geometry instead.
 */
export const builderLibrary = (): Record<string, Module> => ({ ...ASSET_PLACEMENT_MODULES });

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
 * Every asset file embeds its own copy of its pack's texture; `shareTextures`
 * (`@dont-fall/render`, shared with the game) resolves identical ones to one
 * `THREE.Texture` for the builder's session — in the viewport's and the
 * previews' contexts both.
 */
const sharedTextures: SharedTextureCache = new Map();

const defById = new Map(ASSET_MODULE_DEFS.map((def) => [def.id, def]));

/**
 * One file's deck plan (ADR 0096) — the shared collision reader over the same
 * bytes the visual template parses from, shaped and cut exactly like the
 * game's own `loadAssetLibrary` + `resolveTrack` path, so the builder's
 * sheets copy the asset's shape the way the client's already do. Never
 * throws: an unknown id or an unreadable file reads no plan, and the sheets
 * fall back to their rectangles — a tile must never die over a sheet nicety.
 */
export const parseAssetDeckPlan = (moduleId: string, bytes: Uint8Array): DeckPlan | undefined => {
  const def = defById.get(moduleId);
  if (!def) return undefined;
  try {
    const validated = loadAssetModule(bytes, {
      footprint: def.footprint.bounds,
      ...(def.surface === undefined ? {} : { surface: def.surface }),
    });
    return deckPlanOf(attachAssetGeometry(def, validated));
  } catch {
    return undefined;
  }
};

/** Everything one asset file settles into: its visual template plus its deck plan for surface sheets. */
export interface ParsedAsset {
  template: THREE.Group;
  plan: DeckPlan | undefined;
}

/**
 * Parse one fetched asset file (M8 ticket 05): its visual template plus, from
 * the same bytes, its deck plan for surface sheets (ADR 0096).
 * The template is detached from any scene — the viewport clones it once per
 * placed Segment and the tab clones it once per preview. Only a visual
 * failure throws; a missing plan settles as `undefined` (see
 * {@link parseAssetDeckPlan}).
 */
export const parseAsset = async (moduleId: string, bytes: Uint8Array): Promise<ParsedAsset> => {
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
  let template: THREE.Group;
  try {
    template = extractVisualRoot(scene);
  } catch (err) {
    throw new Error(`asset "${moduleId}": ${(err as Error).message}`);
  }
  return { template, plan: parseAssetDeckPlan(moduleId, bytes) };
};

export const ASSET_LOAD_CONCURRENCY = 8;

/**
 * Fetch every tab Module's asset through the API (M8 ticket 05, ADR 0050 as
 * amended — fetched at tab open, never a builder-local copy): its visual
 * template plus its deck plan for surface sheets (ADR 0096), both parsed
 * from the same bytes. `fetchBytes`/`baseUrl` are injected, not
 * builder-hardcoded, mirroring the client's own loader pattern through its
 * own fetch. The URL is derived from the id via the shared `assetFileName`,
 * exactly like `loadAssetLibrary` — the filename stem rule (ADR 0050) holds
 * for every loader, so a mismatch is impossible by construction in any of
 * them.
 *
 * Up to `ASSET_LOAD_CONCURRENCY` files load at once — one at a time was
 * ~1.8 s of tab-open wait for the 124-file asset set.
 */
export const loadAssetVisuals = async (
  fetchBytes: (url: string) => Promise<Uint8Array>,
  baseUrl: string,
  moduleIds: string[] = assetTabModuleIds(),
): Promise<Record<string, ParsedAsset>> => {
  const loaded: ParsedAsset[] = new Array(moduleIds.length);
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
        loaded[index] = await parseAsset(moduleId, bytes);
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
export type AssetVisualResult = ({ ok: true } & ParsedAsset) | { ok: false; error: Error };

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
        onSettled(moduleId, { ok: true, ...(await parseAsset(moduleId, bytes)) });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        onSettled(moduleId, { ok: false, error: new Error(`asset "${moduleId}": ${message}`) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(ASSET_LOAD_CONCURRENCY, moduleIds.length) }, worker));
};
