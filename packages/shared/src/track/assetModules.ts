import { loadAssetModule, type ValidatedAsset } from "./asset.js";
import type { AssetPart } from "./AssetPart.js";
import type { BeltPath } from "./BeltPath.js";
import type { PunchCycle } from "./Punch.js";
import type { BombDef } from "./Bomb.js";
import type { FragileDef } from "./Fragile.js";
import type { SegmentAttachments } from "./Track.js";
import { SHOOTER_BOMB_ASSET_ID, type ShooterDef } from "./Shooter.js";
import type { GateDef } from "./Gate.js";
import type { LaunchDef } from "./Launch.js";
import { BOMB_MODULE_DEFS } from "./bombAssetDefs.js";
import { DF_MODULE_DEFS } from "./dfAssetDefs.js";
import { FAN_MODULE_DEFS } from "./fanAssetDefs.js";
import { GATE_ASSET_DEFS } from "./gateAssetDefs.js";
import { KAYKIT_MODULE_DEFS } from "./kaykitAssetDefs.js";
import { QUARTER_MODULE_DEFS } from "./quarterAssetDefs.js";
import { TRAP_MODULE_DEFS } from "./trapAssetDefs.js";
import type { Footprint, Hazard, Module, Socket } from "./Module.js";
import type { VolumeConfig } from "../simulation/Volume.js";
import type { SegmentColorId } from "./SegmentColor.js";
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
 * The color suffixes the KayKit converter emits per shape
 * (`scripts/convert-kaykit.ts`) — one file each. The four share their texture
 * bytes and differ only in UVs (measured off the GLBs) — which is why
 * authored paint wears the file instead of shifting pixels.
 */
export const LEGACY_ASSET_COLORS = ["blue", "green", "red", "yellow"] as const;

/** One of {@link LEGACY_ASSET_COLORS} — the authored color a legacy module id names. */
export type LegacyAssetColor = (typeof LEGACY_ASSET_COLORS)[number];

/** A color family's shared shape: its stem, the id's own color, and the canonical file new placements load. */
export interface AssetColorFamily {
  /** The shape without its color suffix — what the builder's palette shows once. */
  stem: string;
  /** The color suffix this id carries — always a paintable id, so placing it keeps its look. */
  color: SegmentColorId;
  /** The family's canonical file (`<stem>_red`) — what the palette lists and family placements place. */
  canonicalId: string;
}

/**
 * The color family `moduleId` belongs to, or `null`. A stem groups only when
 * every one of the four files exists in `knownIds` — a lone `_blue` (the
 * quarter pack) is its own look, not a family of one. Defaults to the real
 * registry; tests pass their own id sets.
 */
let knownDefIds: ReadonlySet<string> | null = null;

export const assetColorFamilyOf = (
  moduleId: string,
  knownIds?: ReadonlySet<string>,
): AssetColorFamily | null => {
  const ids = knownIds ?? (knownDefIds ??= new Set(ASSET_MODULE_DEFS.map((def) => def.id)));
  const color = LEGACY_ASSET_COLORS.find((c) => moduleId.endsWith(`_${c}`));
  if (!color) return null;
  const stem = moduleId.slice(0, -color.length - 1);
  if (stem.length === 0) return null;
  if (!LEGACY_ASSET_COLORS.every((c) => ids.has(`${stem}_${c}`))) return null;
  return { stem, color, canonicalId: `${stem}_red` };
};

/**
 * The palette id `moduleId` lists under: a color family's canonical file, or
 * the id itself for lone looks. Legacy placements (`X_blue`) and family
 * placements (`X_red` + paint) meet on one entry this way — the builder's
 * favourites, recents and in-track sets all normalize through here.
 */
export const canonicalPaletteId = (moduleId: string): string =>
  assetColorFamilyOf(moduleId)?.canonicalId ?? moduleId;

/**
 * Every Asset shape once, in registry order: a color family under its
 * canonical file, a lone look as itself. The level anything that *chooses* a
 * Module works at — the builder's Assets tab and the MCP server's
 * `list_modules` both list this, because paint is a Segment Attachment
 * (ADR 0113) and four files were never four choices. Placement is unchanged:
 * every id in the registry stays storable, legacy `X_blue` included.
 */
export const assetPaletteIds = (): string[] => {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const def of ASSET_MODULE_DEFS) {
    const id = canonicalPaletteId(def.id);
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
};

/**
 * Which group of the Track builder's Assets tab lists an Asset Module
 * (CONTEXT.md: Asset category). A listing property only — nothing that
 * simulates reads it, and it grants no behavior: a Sweeper-category mesh is
 * still static geometry until its Segment carries a Motion.
 *
 * One axis, and one only (ADR 0122): **what the piece is to a runner**.
 * Floor is what you stand on, Structure holds the route up or walls it in,
 * a Sweeper moves into you, a Launcher throws you, a Gate is passed through,
 * a Prop is loose enough to shove, and Scenery dresses the rest. A mechanic
 * never moves a piece between groups — a spiked deck is a Floor wearing its
 * `hazard`, a breaking one a Floor wearing its `fragile` — because an author
 * hunting a deck is hunting a deck. The two exceptions are the groups named
 * after the mechanic every member carries: a Gate (ADR 0068) its opening,
 * and a Launcher its throw — a Spring's `launch` (ADR 0069) or a fan's
 * updraft `volumes` (ADR 0075).
 *
 * The order is the reading order the Assets tab and `list_categories` show:
 * the route first, then what comes at you on it, then the dressing.
 */
export const ASSET_CATEGORIES = [
  "floor",
  "structure",
  "sweeper",
  "launcher",
  "gate",
  "prop",
  "scenery",
] as const;
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
  /**
   * This Asset breaks under you (CONTEXT.md: Fragile, ADR 0118) — how many
   * arrivals it takes and how long it stays gone. On the def because the
   * states are authored art; a placed Segment retunes only the return.
   */
  fragile?: FragileDef;
  /**
   * This Asset is a Bomb (CONTEXT.md: Bomb, ADR 0126) — its fuse, its warning
   * and its return. A placed Segment of it is a Prop without saying so, and
   * retunes only the fuse and the return.
   */
  bomb?: BombDef;
  /**
   * What a placed Segment of this Asset carries unless its author says
   * otherwise (ADR 0120) — a belt conveys the moment it is put down. Narrow
   * on purpose: only an Attachment the Asset *is*, never one describing the
   * Track around it, which is why the type names the one field rather than
   * taking `SegmentAttachments` whole.
   */
  attachments?: Pick<SegmentAttachments, "conveyor">;
  /** The loop this Asset's slats ride (ADR 0120) — drawn only, at the speed its Conveyor runs. */
  belt?: BeltPath;
  /** This Asset punches (CONTEXT.md: Punching Glove, ADR 0121) — the authored swing its Parts share. */
  punch?: PunchCycle;
  /** This Asset fires a ball along its barrel (CONTEXT.md: Shooter, ADR 0119) — where the muzzle is, and what it does by default. */
  shooter?: ShooterDef;
  /**
   * This Asset's own visual tolerance, when {@link ASSET_VISUAL_WARN} is not
   * the right number for it (see `ValidateAssetOptions.visualTolerance`).
   * Always carries the reason beside it.
   */
  visualTolerance?: number;
  /**
   * The Parts this Asset resolves into (ADR 0116) — declared on the few
   * Assets built from more than one body, matching the `part` extras
   * `scripts/convert-df.ts` stamped on their nodes. Absent on every Asset
   * that is one rigid piece, which is all of them but four.
   */
  parts?: AssetPart[];
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
    category: "floor",
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

export const ASSET_MODULE_DEFS: AssetModuleDef[] = [
  ...PROMOTED_SOCKETED,
  ...BOMB_MODULE_DEFS,
  ...DF_MODULE_DEFS,
  ...FAN_MODULE_DEFS,
  ...KAYKIT_MODULE_DEFS,
  ...QUARTER_MODULE_DEFS,
  ...TRAP_MODULE_DEFS,
].map((def) => {
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
  ...(def.parts !== undefined ? { parts: def.parts } : {}),
  ...(def.fragile !== undefined ? { fragile: def.fragile } : {}),
  ...(def.bomb !== undefined ? { bomb: def.bomb } : {}),
  ...(def.shooter !== undefined ? { shooter: def.shooter } : {}),
  ...(def.attachments !== undefined ? { attachments: def.attachments } : {}),
  ...(def.belt !== undefined ? { belt: def.belt } : {}),
  ...(def.punch !== undefined ? { punch: def.punch } : {}),
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
      ...(def.parts === undefined ? {} : { parts: def.parts }),
      ...(def.fragile === undefined ? {} : { fragile: def.fragile }),
      ...(def.bomb === undefined ? {} : { bomb: def.bomb }),
      ...(def.shooter === undefined ? {} : { shooter: def.shooter }),
      ...(def.attachments === undefined ? {} : { attachments: def.attachments }),
      ...(def.belt === undefined ? {} : { belt: def.belt }),
      ...(def.punch === undefined ? {} : { punch: def.punch }),
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
        ...(def.visualTolerance === undefined ? {} : { visualTolerance: def.visualTolerance }),
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
 * nothing else — and the bomb a Shooter that fires bombs fires (ADR 0127),
 * which no Segment places. Procedural and unknown ids are not Assets;
 * `resolveTrack` still names an unknown one when the Track is built.
 */
export const assetIdsOf = (track: Track): string[] => [
  ...new Set(
    track
      .flatMap((segment) => (segment.shooter?.ammo === "bomb" ? [segment.moduleId, SHOOTER_BOMB_ASSET_ID] : [segment.moduleId]))
      .filter((id) => ASSET_DEF_BY_ID.has(id)),
  ),
];

/**
 * The authored file a painted family Segment wears (`X_red` + blue wears
 * `X_blue.glb`'s own bytes — the character's `paintModel`: authored art wins
 * outright, nothing synthesised), or `null` when the paint is a flat tint
 * instead: a new hue (orange/cyan/purple/pink, which no file carries), or a
 * Segment with no family at all. `red` on the canonical answers the
 * canonical itself — the identity needs no second file.
 */
export const authoredPaintFileId = (moduleId: string, color: SegmentColorId): string | null => {
  const family = assetColorFamilyOf(moduleId);
  if (!family) return null;
  if (!(LEGACY_ASSET_COLORS as readonly string[]).includes(color)) return null;
  return `${family.stem}_${color}`;
};

/**
 * The Asset files a *renderer* needs for `track`: what it places
 * ({@link assetIdsOf}) plus the authored paint files its painted Segments
 * wear ({@link authoredPaintFileId}) — a blue-painted canonical loads both
 * `_red` (placed) and `_blue` (worn). Collision never reads paint, so the
 * physics half keeps loading {@link assetIdsOf} alone. Each id once, placed
 * files first in first-placed order, paint files after in first-needed order.
 */
export const visualAssetIdsOf = (track: Track): string[] => {
  const ids = assetIdsOf(track);
  const seen = new Set(ids);
  for (const segment of track) {
    if (segment.color === undefined) continue;
    const fileId = authoredPaintFileId(segment.moduleId, segment.color);
    if (fileId === null || seen.has(fileId) || !ASSET_DEF_BY_ID.has(fileId)) continue;
    seen.add(fileId);
    ids.push(fileId);
  }
  return ids;
};

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
