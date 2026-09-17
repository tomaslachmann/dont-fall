import { loadAssetModule, type ValidatedAsset } from "./asset.js";
import type { GateDef } from "./Gate.js";
import type { LaunchDef } from "./Launch.js";
import { FAN_MODULE_DEFS } from "./fanAssetDefs.js";
import { GATE_ASSET_DEFS } from "./gateAssetDefs.js";
import { KAYKIT_MODULE_DEFS } from "./kaykitAssetDefs.js";
import { TRAP_MODULE_DEFS } from "./trapAssetDefs.js";
import type { Footprint, Hazard, Module, Socket } from "./Module.js";
import type { VolumeConfig } from "../simulation/Volume.js";
import type { SurfaceId } from "./Surface.js";
import type { Track } from "./Track.js";

/**
 * The code-authored half of an asset Module (M8 ticket 02, ADR 0050) —
 * everything a GLB file does *not* carry: footprint, Sockets, default
 * Surface. Collision geometry arrives per-consumer through
 * {@link loadAssetLibrary} (server at boot, client at track load — all
 * through the API, ADR 0050 as amended); the builder never simulates
 * and reads only these defs plus visual bytes. Measured numbers below kept
 * honest by `assetModules.test.ts`, which revalidates every footprint
 * against its real file.
 */

/** Filename stem rule (ADR 0050): `<moduleId>.glb`, derived from the id — a mismatch is impossible by construction. */
export const assetFileName = (moduleId: string): string => `${moduleId}.glb`;

/**
 * Which group of the Track builder's Assets tab lists an Asset Module
 * (CONTEXT.md: Asset category). A listing property only — nothing that
 * simulates reads it, and it grants no behavior: an Obstacle-category mesh
 * is still static geometry until its Module carries a mechanic. Three
 * categories are the exceptions that always carry one, in their defs: a Gate
 * (ADR 0068) its opening, a Spring (ADR 0069) its launch, and a Fan (ADR
 * 0075) its Volumes.
 */
export const ASSET_CATEGORIES = ["platform", "obstacle", "spring", "gate", "fan", "scenery"] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export interface AssetModuleDef {
  id: string;
  category: AssetCategory;
  footprint: Footprint;
  sockets: Socket[];
  surface?: SurfaceId;
  /** Spiked or not (ADR 0061) — assigned per stem by the converters, like `category`. */
  hazard?: Hazard;
  /** A Gate's opening and role (ADR 0068) — present exactly on Gate-category Assets, fitted by `pnpm fit:gates`. */
  gate?: GateDef;
  /**
   * This Asset is a Spring (CONTEXT.md: Spring, ADR 0069) — its trigger and
   * its default throw. Assigned per stem by the converters, like `category`
   * and `hazard`; a placed Spring always launches.
   */
  launch?: LaunchDef;
  /**
   * The Volumes (CONTEXT.md: Volume, ADR 0036) this Asset carries — an
   * updraft above a fan, a wind tunnel past a vent — authored in the def's
   * own local space exactly like a procedural Module's, and resolved into
   * world space by the same `resolveTrack` path. The third mechanic that
   * rides a def (ADR 0075), beside a Spring's `launch` and a Gate's
   * opening: a Surface can't express it (a Surface is contact, a Volume is
   * a region of space), so it travels as itself.
   */
  volumes?: VolumeConfig[];
}

const box = (center: { x: number; y: number; z: number }, halfExtents: { x: number; y: number; z: number }) => ({
  center,
  halfExtents,
});

/**
 * The travel convention every Socket below follows, stated once (it is M1's,
 * never re-decided): a Track chains toward **−Z**, a Socket faces *outward*
 * from its Module, and `yaw` θ points it along `(−sin θ, 0, −cos θ)` — so 0
 * faces −Z, π faces +Z, π/2 faces −X and −π/2 faces +X. An `entry` therefore
 * sits on the +Z face at yaw π and a straight-through `exit` on the −Z face
 * at yaw 0.
 */
const YAW_FORWARD = 0; // −Z: a straight-through exit
const YAW_BACK = Math.PI; // +Z: an entry

// The original 28 hand-wired Modules (M8's four + the M9 block set) were
// deleted with their files (user decision, 2026-09-14 — the converted packs
// below replace them). The deck/ramp/turn/prop helpers went with them; what
// remains is conversions plus hand-promoted pieces.

/**
 * Promoted pieces: converted-pack Modules hand-given Sockets. Each entry
 * names its measured footprint — copied from the generated def it replaces
 * — plus entry/exit on the walking faces. The convert scripts skip these
 * ids when emitting (`PROMOTED_SOCKETED_IDS`), so a re-conversion never
 * re-adds a socketless twin; promote here only what the builder eyeball (or,
 * for the utterly unambiguous symmetric floor below, plain symmetry) has
 * blessed.
 */
const PROMOTED_SOCKETED: AssetModuleDef[] = [
  {
    id: "kaykit_floor_wood_2x2",
    category: "platform",
    // Measured (convert output): 2 x 0.5 x 2 slab, x/z symmetric about the
    // origin, top walking face at y = 0.5. Unlike the deleted M9 block set
    // (origin-centred, top at +half.y), KayKit pieces sit ON y = 0 — socket
    // height reads the measured top, never the half-extent.
    footprint: { bounds: box({ x: 0, y: 0.25, z: 0 }, { x: 1, y: 0.25, z: 1 }), clearance: 0.5 },
    sockets: [
      { id: "entry", type: "floor", position: { x: 0, y: 0.5, z: 1 }, yaw: YAW_BACK },
      { id: "exit", type: "floor", position: { x: 0, y: 0.5, z: -1 }, yaw: YAW_FORWARD },
    ],
  },
];

export const ASSET_MODULE_DEFS: AssetModuleDef[] = [...PROMOTED_SOCKETED, ...FAN_MODULE_DEFS, ...KAYKIT_MODULE_DEFS, ...TRAP_MODULE_DEFS].map((def) => {
  const gate = GATE_ASSET_DEFS[def.id];
  return gate === undefined ? def : { ...def, gate };
});

/**
 * Shape one registry entry from a def and its validated bytes (M8 ticket
 * 02): the Module kind alongside procedural ones. `statics` stays empty —
 * this Module's collision is `asset.meshes`, baked by `resolveTrack` into
 * trimeshes; the builder viewport draws nothing for it until ticket 05.
 */
export const attachAssetGeometry = (def: AssetModuleDef, validated: ValidatedAsset): Module => ({
  id: def.id,
  statics: [],
  asset: { meshes: validated.collision, ...(validated.solid.length > 0 ? { solid: validated.solid } : {}) },
  sockets: def.sockets,
  footprint: def.footprint,
  ...(def.surface !== undefined ? { surface: def.surface } : {}),
  ...(def.hazard !== undefined ? { hazard: def.hazard } : {}),
  ...(def.gate !== undefined ? { gate: def.gate } : {}),
  ...(def.launch !== undefined ? { launch: def.launch } : {}),
  ...(def.volumes !== undefined ? { volumes: def.volumes } : {}),
});

/**
 * Where one file's validation warnings go (M8 ticket 03) — `validateAssetModule`
 * returns them without logging (shared code owns no console), so the caller
 * decides where a developer sees them: the client's track load warns, the
 * server stays quiet. Optional and default-off, so omitting it keeps
 * ticket-02 behavior exactly.
 */
export type AssetWarningHandler = (moduleId: string, warning: string) => void;

/**
 * The defs as chainable/placeable Modules (M8 ticket 05): id, Sockets,
 * footprint and default Surface — everything short of geometry. Chaining,
 * the builder's placement machinery and publish validation never read
 * triangles, so they share this instead of each carrying its own
 * def-to-Module mapping; anything that simulates resolves the same ids
 * through {@link attachAssetGeometry} with real bytes instead.
 */
export const ASSET_PLACEMENT_MODULES: Record<string, Module> = Object.fromEntries(
  ASSET_MODULE_DEFS.map((def) => [
    def.id,
    {
      id: def.id,
      statics: [],
      sockets: def.sockets,
      footprint: def.footprint,
      ...(def.surface === undefined ? {} : { surface: def.surface }),
      ...(def.hazard === undefined ? {} : { hazard: def.hazard }),
      ...(def.gate === undefined ? {} : { gate: def.gate }),
      ...(def.launch === undefined ? {} : { launch: def.launch }),
      ...(def.volumes === undefined ? {} : { volumes: def.volumes }),
    } satisfies Module,
  ]),
);

/**
 * Fetch every def's bytes and shape the asset half of a Module library
 * (M8 ticket 02). `fetchBytes` is injected — the API over HTTP in
 * production, committed files (or tiny fixtures) in tests — so this stays
 * orchestration with no platform in it. Fails the whole load on the first
 * bad file, naming it: a half-loaded library would simulate half a Track.
 */
export const loadAssetLibrary = async (
  fetchBytes: (url: string) => Promise<Uint8Array>,
  baseUrl: string,
  defs: AssetModuleDef[] = ASSET_MODULE_DEFS,
  onWarning?: AssetWarningHandler,
): Promise<Record<string, Module>> => {
  const entries: Record<string, Module> = {};
  for (const def of defs) {
    const url = `${baseUrl}/${assetFileName(def.id)}`;
    let bytes: Uint8Array;
    try {
      bytes = await fetchBytes(url);
    } catch (err) {
      throw new Error(`asset "${def.id}": could not fetch ${url}: ${(err as Error).message}`);
    }
    let validated: ValidatedAsset;
    try {
      validated = loadAssetModule(bytes, {
        footprint: def.footprint.bounds,
        ...(def.surface === undefined ? {} : { surface: def.surface }),
      });
    } catch (err) {
      throw new Error(`asset "${def.id}": ${(err as Error).message}`);
    }
    for (const warning of validated.warnings) onWarning?.(def.id, warning);
    entries[def.id] = attachAssetGeometry(def, validated);
  }
  return entries;
};

const ASSET_DEF_BY_ID = new Map(ASSET_MODULE_DEFS.map((def) => [def.id, def]));

/**
 * The Asset Module ids `track` places, each once, in the order first placed
 * (memory-footprint ticket 01): the files a loader needs for this Track and
 * nothing else. Procedural and unknown ids are not Assets; `resolveTrack`
 * still names an unknown one when the Track is built.
 */
export const assetIdsOf = (track: Track): string[] => [
  ...new Set(track.map((segment) => segment.moduleId).filter((id) => ASSET_DEF_BY_ID.has(id))),
];

/** The Asset ids `track` places that `library` holds no geometry for yet. */
export const missingAssetIds = (track: Track, library: Record<string, Module>): string[] =>
  assetIdsOf(track).filter((id) => library[id]?.asset === undefined);

/**
 * A loader that fetches Assets as Tracks need them (memory-footprint ticket
 * 01, ADR 0080). Each id is fetched and parsed at most once per loader, so a
 * running server never refetches an id under a world it already built (ADR
 * 0050's fetch-once rule, per id). Concurrent loads of the same id share one
 * fetch. A failed id is not remembered, so a later load tries it again.
 */
export interface AssetLibraryLoader {
  /** Loads whatever of `ids` is not loaded yet, then resolves to every Asset this loader holds. */
  load: (ids: readonly string[]) => Promise<Record<string, Module>>;
}

export const createAssetLibraryLoader = (
  fetchBytes: (url: string) => Promise<Uint8Array>,
  baseUrl: string,
  onWarning?: AssetWarningHandler,
): AssetLibraryLoader => {
  const loading = new Map<string, Promise<Module>>();
  const loaded: Record<string, Module> = {};
  const loadOne = (def: AssetModuleDef): Promise<Module> => {
    const existing = loading.get(def.id);
    if (existing) return existing;
    const pending = loadAssetLibrary(fetchBytes, baseUrl, [def], onWarning).then(
      (entries) => {
        const module = entries[def.id]!;
        loaded[def.id] = module;
        return module;
      },
      (err: unknown) => {
        loading.delete(def.id);
        throw err;
      },
    );
    loading.set(def.id, pending);
    return pending;
  };
  return {
    load: async (ids) => {
      const defs = [...new Set(ids)].flatMap((id) => {
        const def = ASSET_DEF_BY_ID.get(id);
        return def === undefined ? [] : [def];
      });
      await Promise.all(defs.map(loadOne));
      return { ...loaded };
    },
  };
};
