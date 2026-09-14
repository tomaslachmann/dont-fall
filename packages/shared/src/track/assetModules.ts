import { loadAssetModule, type ValidatedAsset } from "./asset.js";
import type { Footprint, Module, Socket } from "./Module.js";
import type { SurfaceId } from "./Surface.js";
import { chainTrack, type Track } from "./Track.js";
import { M1_MODULES } from "./modules.js";

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

/**
 * The travel convention every Socket below follows, stated once (it is M1's
 * and M8's, never re-decided): a Track chains toward **−Z**, a Socket faces
 * *outward* from its Module, and `yaw` θ points it along `(−sin θ, 0, −cos θ)`
 * — so 0 faces −Z, π faces +Z, π/2 faces −X and −π/2 faces +X. An `entry`
 * therefore sits on the +Z face at yaw π and a straight-through `exit` on
 * the −Z face at yaw 0.
 */
const YAW_FORWARD = 0; // −Z: a straight-through exit
const YAW_BACK = Math.PI; // +Z: an entry
const YAW_RIGHT = -Math.PI / 2; // +X: the exit of a right-hand turn

/**
 * A flat deck walked straight through — the shape most of the M9 block set
 * is. `half` is the measured half-extent on each axis; the deck is the slab's
 * top face, so both Sockets sit at `half.y`.
 */
const deckModule = (id: string, half: { x: number; y: number; z: number }, surface?: SurfaceId): AssetModuleDef => ({
  id,
  footprint: { bounds: box({ x: 0, y: 0, z: 0 }, half), clearance: 0.5 },
  sockets: [
    { id: "entry", type: "floor", position: { x: 0, y: half.y, z: half.z }, yaw: YAW_BACK },
    { id: "exit", type: "floor", position: { x: 0, y: half.y, z: -half.z }, yaw: YAW_FORWARD },
  ],
  ...(surface === undefined ? {} : { surface }),
});

/**
 * A wedge: flat underside at `−half.y`, deck rising (or falling) across the
 * piece between `−half.y` and `+half.y`. `climbs` is measured off the file,
 * never assumed from the name — it says which end of the deck is high in
 * the −Z travel direction.
 */
const rampModule = (id: string, half: { x: number; y: number; z: number }, climbs: boolean): AssetModuleDef => ({
  id,
  footprint: { bounds: box({ x: 0, y: 0, z: 0 }, half), clearance: 0.5 },
  sockets: [
    { id: "entry", type: "floor", position: { x: 0, y: climbs ? -half.y : half.y, z: half.z }, yaw: YAW_BACK },
    { id: "exit", type: "floor", position: { x: 0, y: climbs ? half.y : -half.y, z: -half.z }, yaw: YAW_FORWARD },
  ],
});

/**
 * A deck entered on +Z and left on +X — a right-hand turn, the same handedness
 * M8's `corner_lshape` already turns (enter heading +X, leave heading +Z).
 * Left turns are the same Module placed rotated, not a second file.
 */
const turnModule = (id: string, half: { x: number; y: number; z: number }): AssetModuleDef => ({
  id,
  footprint: { bounds: box({ x: 0, y: 0, z: 0 }, half), clearance: 0.5 },
  sockets: [
    { id: "entry", type: "floor", position: { x: 0, y: half.y, z: half.z }, yaw: YAW_BACK },
    { id: "exit", type: "floor", position: { x: half.x, y: half.y, z: 0 }, yaw: YAW_RIGHT },
  ],
});

/**
 * Scenery and obstacles — a barrier, a bumper, a post, a pillar, a side rail.
 * **No Sockets at all**, deliberately: a Socket is a connection point, and
 * nothing chains onto a bollard. `Module` has allowed this since ADR 0034's
 * free placement (the Survival arena was the first such piece), and it is
 * what keeps these out of `chainTrack`'s way while the builder can still
 * drop them anywhere.
 */
const propModule = (id: string, half: { x: number; y: number; z: number }): AssetModuleDef => ({
  id,
  footprint: { bounds: box({ x: 0, y: 0, z: 0 }, half), clearance: 0.5 },
  sockets: [],
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
    // Measured — a true L since ticket 04's remodel (extruded outline, top
    // y = 0.5): the west-east arm spans x in [-2, 6], z in [-2, 2] and the
    // south-north arm x in [2, 6], z in [2, 6]; the x in [-2, 2], z in [2, 6]
    // quadrant is void. Entry stays the west end (faces -X, as before); the
    // exit turns 90° onto the north end (faces +Z, yaw π — the same facing
    // every +Z-facing Socket in this file and M1's uses).
    footprint: { bounds: box({ x: 2, y: 0, z: 2 }, { x: 4, y: 0.5, z: 4 }), clearance: 0.5 },
    sockets: [
      { id: "entry", type: "floor", position: { x: -2, y: 0.5, z: 0 }, yaw: Math.PI / 2 },
      { id: "exit", type: "floor", position: { x: 4, y: 0.5, z: 6 }, yaw: Math.PI },
    ],
  },

  // ---------------------------------------------------------------------
  // The M9 block set (2026-09-11) — a finer, uniform grid than M8's four
  // above: 2 world units per "1", a 0.5-thick deck whose top sits at y =
  // 0.25, and every piece origin-centred. Measured with `pnpm check:assets`
  // and re-measured against the real files by `assetModules.test.ts`.
  //
  // These do NOT chain flush with M8's four (a 4x4 deck 1 unit thick, top at
  // y = 0.5). Both families are placeable; mixing them in one chain steps.
  // ---------------------------------------------------------------------

  // Straight decks. 1x1 = 2 long, doubling to 1x8 = 16.
  deckModule("straight_1x1", { x: 1, y: 0.25, z: 1 }),
  deckModule("straight_1x2", { x: 1, y: 0.25, z: 2 }),
  deckModule("straight_1x4", { x: 1, y: 0.25, z: 4 }),
  deckModule("straight_1x8", { x: 1, y: 0.25, z: 8 }),

  // Wider decks, for a junction or a breather. Straight through, like the
  // pieces above — a wide deck is still walked in one direction.
  deckModule("platform_2x2", { x: 2, y: 0.25, z: 2 }),
  deckModule("platform_3x3", { x: 3, y: 0.25, z: 3 }),

  // Wedges rising 0.5 over their length: ~14 degrees on the 1x1, ~7 on the
  // 1x2. Both are far inside the walkable band (ADR 0037), so unlike M8's
  // `ramp_45` — which had to be seated descending because a 45-degree climb
  // is unclimbable — these genuinely climb in the travel direction, and the
  // "up"/"down" in their names is true. Measured, not assumed: `ramp_up`'s
  // +Z end is the file's low edge (y = -0.25), its -Z end the high one.
  rampModule("ramp_up_1x1", { x: 1, y: 0.25, z: 1 }, true),
  rampModule("ramp_up_1x2", { x: 1, y: 0.25, z: 2 }, true),
  rampModule("ramp_down_1x1", { x: 1, y: 0.25, z: 1 }, false),
  rampModule("ramp_down_1x2", { x: 1, y: 0.25, z: 2 }, false),

  // Right-hand turns. Both files are currently square blockout decks rather
  // than arcs (see the collision note in ticket 17), which a 90-degree turn
  // is served by regardless: you enter on +Z, cross the deck, leave on +X.
  turnModule("corner_90_r1", { x: 2, y: 0.25, z: 2 }),
  turnModule("curve_90_r2", { x: 3, y: 0.25, z: 3 }),

  // Raised decks (top at y = 0.75). Blockout solids today — the tunnel has
  // no bore and the bridge no span, so both currently play as raised decks
  // you walk over rather than through.
  deckModule("bridge_1x2", { x: 1, y: 0.75, z: 2 }),
  deckModule("tunnel_1x2", { x: 1, y: 0.75, z: 2 }),

  // The `special_` family. Only the bounce pad carries a mechanic today:
  // `surface: "bounce"` is a real Surface (ADR 0036/M3.7 ticket 02), so this
  // one does what its name says. The other three are geometry only — there
  // is no moving-platform entity at all, `AssetModuleDef` carries no
  // `spinners`, and the hole's collision is solid with no hole in it. They
  // are placeable decks; making them behave is ticket 17's follow-up.
  deckModule("special_bounce_pad_1x1", { x: 1, y: 0.25, z: 1 }, "bounce"),
  deckModule("special_hole_1x1", { x: 1, y: 0.25, z: 1 }),
  deckModule("special_moving_platform_1x2", { x: 1, y: 0.25, z: 2 }),
  deckModule("special_spinner_mount_1x1", { x: 1, y: 0.25, z: 1 }),

  // Scenery and obstacles — no Sockets, nothing chains onto them.
  propModule("barrier_1x1", { x: 1, y: 0.3, z: 0.15 }),
  propModule("bumper_1x1", { x: 1, y: 0.2, z: 0.2 }),
  propModule("cone_post_1x1", { x: 0.2, y: 0.4, z: 0.2 }),
  propModule("pillar_1x1", { x: 1, y: 1, z: 1 }),
  propModule("side_rail_left_1x1", { x: 0.1, y: 0.2, z: 1 }),
  propModule("side_rail_right_1x1", { x: 0.1, y: 0.2, z: 1 }),
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
 * The milestone playtest Track (M8 ticket 04): all four asset Modules in one
 * run, ending on M1's `finish` piece so a Race on it can actually Qualify —
 * asset Modules carry no Finish Zone of their own. Chained through Sockets
 * exactly like `M1_TRACK`, so socket re-measurements re-seat it
 * automatically; a test below walks it end to end in the sim. Seeded by
 * the API under {@link ASSET_DEMO_TRACK_ID}.
 *
 * Chaining needs only Sockets, never geometry — so this is pure (no bytes,
 * no fetch) and both sides derive the identical Segments. The asset entries
 * here are their defs' socket/footprint halves; `attachAssetGeometry`
 * provides the geometry half per consumer.
 */
export const ASSET_DEMO_TRACK_ID = "asset-demo";

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
    } satisfies Module,
  ]),
);

export const ASSET_DEMO_TRACK: Track = chainTrack(
  ["platform_straight", "ramp_45", "stairs_4step", "corner_lshape", "finish"],
  { ...ASSET_PLACEMENT_MODULES, finish: M1_MODULES.finish! },
  { x: 0, y: 0, z: 10 },
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
