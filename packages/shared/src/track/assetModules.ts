import { loadAssetModule, type ValidatedAsset } from "./asset.js";
import type { Footprint, Module, Socket } from "./Module.js";
import type { SurfaceId } from "./Surface.js";

/**
 * The code-authored half of an asset Module (M8 ticket 02, ADR 0050) —
 * everything a GLB file does *not* carry: footprint, Sockets, default
 * Surface. Geometry arrives per-consumer through {@link loadAssetLibrary}
 * (server at boot, client at track load, builder at tab open — all through
 * track-service, ADR 0050 as amended), measured numbers below kept honest
 * by `assetModules.test.ts`, which revalidates every footprint against its
 * real file.
 */

/** Filename stem rule (ADR 0050): `<moduleId>.glb`, derived from the id — a mismatch is impossible by construction. */
export const assetFileName = (moduleId: string): string => `${moduleId}.glb`;

export interface AssetModuleDef {
  id: string;
  footprint: Footprint;
  sockets: Socket[];
  surface?: SurfaceId;
}

const box = (center: { x: number; y: number; z: number }, halfExtents: { x: number; y: number; z: number }) => ({
  center,
  halfExtents,
});

export const ASSET_MODULE_DEFS: AssetModuleDef[] = [
  {
    id: "platform_straight",
    // Measured: 4 x 1 x 4 box, top walking surface at y = 0.5.
    footprint: { bounds: box({ x: 0, y: 0, z: 0 }, { x: 2, y: 0.5, z: 2 }), clearance: 0.5 },
    sockets: [
      { id: "entry", type: "floor", position: { x: 0, y: 0.5, z: 2 }, yaw: Math.PI },
      { id: "exit", type: "floor", position: { x: 0, y: 0.5, z: -2 }, yaw: 0 },
    ],
  },
  {
    id: "ramp_45",
    // Measured: wedge spanning x/z ±2, rising from the toe (y = -2 at z = -2)
    // to the ridge (y = +2 at z = +2) — a true 45°.
    footprint: { bounds: box({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 }), clearance: 0.5 },
    sockets: [
      { id: "entry", type: "floor", position: { x: 0, y: 2, z: 2 }, yaw: Math.PI },
      { id: "exit", type: "floor", position: { x: 0, y: -2, z: -2 }, yaw: 0 },
    ],
  },
  {
    id: "stairs_4step",
    // Measured: x/z ±2, base y = -0.5, four tread tops at -0.25 (z in
    // [1, 2]) → 0.125 (z in [0, 1]) → 0.5 (z in [-1, 0]) → 0.875 plateau
    // (z in [-2, -1]). Read the TOP FACES, not the side walls: max-Y verts
    // in a band are riser edges, and misreading them once seated the exit
    // 0.375 proud as a wall (caught by the chained descent test, not by
    // review — the physics stood exactly where it should the whole time).
    //
    // Seated to DESCEND in the travel direction (entry high, exit low) — a
    // deliberate deviation from "climbs" (user decision, M8 ticket 02): the
    // engine mounts at most ~0.15 lips with autostep off (M3.6's measured
    // rationale), so 0.375 risers are unclimbable without a movement-feel
    // redesign, while 0.375 drops descend smoothly under snap-to-ground.
    // Geometry untouched; like every M1 module, this one goes downhill.
    footprint: { bounds: box({ x: 0, y: 0.1875, z: 0 }, { x: 2, y: 0.6875, z: 2 }), clearance: 0.5 },
    sockets: [
      { id: "entry", type: "floor", position: { x: 0, y: 0.875, z: -2 }, yaw: 0 },
      { id: "exit", type: "floor", position: { x: 0, y: -0.25, z: 2 }, yaw: Math.PI },
    ],
  },
  {
    id: "corner_lshape",
    // Measured — and the file is HONESTLY NOT AN L: collision and visual are
    // the same 8 x 1 x 4 straight slab (x in [-2, 6], top y = 0.5). Socketed
    // along its long axis like any straight until ticket 04 remodels it
    // into a real corner (or renames it): entry faces -X, exit faces +X.
    footprint: { bounds: box({ x: 2, y: 0, z: 0 }, { x: 4, y: 0.5, z: 2 }), clearance: 0.5 },
    sockets: [
      { id: "entry", type: "floor", position: { x: -2, y: 0.5, z: 0 }, yaw: Math.PI / 2 },
      { id: "exit", type: "floor", position: { x: 6, y: 0.5, z: 0 }, yaw: -Math.PI / 2 },
    ],
  },
];

/**
 * Shape one registry entry from a def and its validated bytes (M8 ticket
 * 02): the Module kind alongside procedural ones. `statics` stays empty —
 * this Module's collision is `asset.meshes`, baked by `resolveTrack` into
 * trimeshes; the builder viewport draws nothing for it until ticket 05.
 */
export const attachAssetGeometry = (def: AssetModuleDef, validated: ValidatedAsset): Module => ({
  id: def.id,
  statics: [],
  asset: { meshes: validated.collision },
  sockets: def.sockets,
  footprint: def.footprint,
  ...(def.surface !== undefined ? { surface: def.surface } : {}),
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
 * Fetch every def's bytes and shape the asset half of a Module library
 * (M8 ticket 02). `fetchBytes` is injected — track-service over HTTP in
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
