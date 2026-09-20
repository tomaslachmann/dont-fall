import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ASSET_CATEGORIES,
  ASSET_MODULE_DEFS,
  ATTACHMENTS,
  CONVEYOR_PRESETS,
  LAUNCH_HEIGHT_MAX,
  LAUNCH_HEIGHT_MIN,
  MOTION_EASINGS,
  MODULE_LIBRARY,
  SEGMENT_COLORS,
  assetColorFamilyOf,
  type AssetCategory,
  type AttachmentKey,
  type StoredTrack,
  type TrackListing,
} from "@dont-fall/shared";
import { z } from "zod";
import type { TrackApi } from "../api.js";
import { jsonTool, page } from "../tools.js";

/**
 * Staged discovery (ADR 0114, D3): groups → modules → full detail, never one
 * giant dump. Registry data comes from `@dont-fall/shared` (code,
 * version-locked with this package); stored Tracks come over the API.
 */

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

const PAGING = {
  offset: z.number().int().min(0).default(0).describe("Skip this many entries."),
  limit: z.number().int().min(1).max(200).default(50).describe("Take at most this many entries."),
};

export const registerDiscoveryTools = (server: McpServer, api: TrackApi): void => {
  jsonTool(
    server,
    "list_categories",
    "First discovery step: the Asset groups (platform/obstacle/spring/gate/fan/scenery) with module counts. Then list_modules per group, then get_module for full defs.",
    {},
    async () => ({
      categories: ASSET_CATEGORIES.map((id) => ({
        id,
        moduleCount: ASSET_MODULE_DEFS.filter((def) => def.category === id).length,
      })),
    }),
  );

  jsonTool(
    server,
    "list_modules",
    "Second discovery step: module summaries in one category — id, size in metres (x/y/z), deck top (where feet land), socket count, color family. Full defs via get_module. KayKit pieces sit ON y=0 (nothing hangs below).",
    { category: z.enum(ASSET_CATEGORIES).describe("One id from list_categories."), ...PAGING },
    async ({ category, offset, limit }) => {
      const defs = ASSET_MODULE_DEFS.filter((def) => def.category === (category as AssetCategory));
      return page(
        defs.map((def) => {
          const { center, halfExtents: h } = def.footprint.bounds;
          const family = assetColorFamilyOf(def.id);
          return {
            id: def.id,
            size: { x: round3(h.x * 2), y: round3(h.y * 2), z: round3(h.z * 2) },
            top: round3(center.y + h.y),
            sockets: def.sockets.length,
            family: family ? { stem: family.stem, color: family.color, canonicalId: family.canonicalId } : null,
          };
        }),
        offset,
        limit,
      );
    },
  );

  jsonTool(
    server,
    "list_procedural_modules",
    "The few legacy procedural modules (start/finish/mud/ice/pads/updraft, M1 fixtures) — id, size, deck top. Prefer Assets (list_modules): the builder places those, these exist for old Tracks and tests.",
    {},
    async () => ({
      modules: Object.values(MODULE_LIBRARY).map((module) => {
        const { center, halfExtents: h } = module.footprint.bounds;
        return {
          id: module.id,
          legacy: true,
          size: { x: round3(h.x * 2), y: round3(h.y * 2), z: round3(h.z * 2) },
          top: round3(center.y + h.y),
        };
      }),
    }),
  );

  jsonTool(
    server,
    "get_module",
    "Full module def: footprint (bounds + clearance), sockets (entry/exit, yaw convention: tracks chain toward -Z), default surface, color family, and — when the def authors one — hazard, gate opening/role, spring launch, volumes. Unknown ids error with a pointer back to list_modules.",
    { id: z.string().describe("Module id from list_modules or list_procedural_modules.") },
    async ({ id }) => {
      const def = ASSET_MODULE_DEFS.find((candidate) => candidate.id === id);
      if (def) {
        const family = assetColorFamilyOf(def.id);
        return { ...def, family: family ? { ...family } : null };
      }
      const procedural = MODULE_LIBRARY[id];
      if (procedural) {
        return {
          id: procedural.id,
          category: "procedural" as const,
          legacy: true,
          footprint: procedural.footprint,
          sockets: procedural.sockets,
        };
      }
      throw new Error(`unknown Module id "${id}" — list_modules per category, or list_procedural_modules`);
    },
  );

  jsonTool(
    server,
    "list_attachments",
    "Every attachment a Segment may carry (motion/conveyor/ice/mud/bounce/launch/prop/start/checkpoint/color): its noun and storable value shape. Shapes are enforced by the shared validators — this is the readable map of what they accept.",
    {},
    async () => ATTACHMENT_REFERENCE,
  );

  jsonTool(
    server,
    "list_tracks",
    "Stored Tracks (latest Revision each): id, name, revision, segment count, clock, survivor target, environment. Read one fully with get_track to use it as a draft source.",
    {},
    async () => ({ tracks: await api.get<TrackListing[]>("/tracks") }),
  );

  jsonTool(
    server,
    "get_track",
    "One stored Revision: metadata plus Segments paged (a Race runs 300+ — never read whole). Pass to create_draft's from-source to branch it.",
    {
      id: z.string().describe("Track id from list_tracks."),
      revision: z.number().int().min(1).optional().describe("Pinned Revision; latest when absent."),
      ...PAGING,
    },
    async ({ id, revision, offset, limit }) => {
      const stored = await api.get<StoredTrack>(`/tracks/${id}${revision === undefined ? "" : `?revision=${revision}`}`);
      const { track, ...meta } = stored;
      return { ...meta, segments: page(track, offset, limit) };
    },
  );
};

/**
 * The readable map of storable attachment values (ADR 0114, D6) — keyed by
 * {@link AttachmentKey} and compiler-held complete, so a field added to the
 * registry does not compile until it is described here. Enforcement stays
 * with the shared `invalid*Reason` validators; these strings teach the LLM
 * what to write.
 */
const ATTACHMENT_REFERENCE: Record<AttachmentKey, { noun: string; value: string }> = {
  motion: {
    noun: ATTACHMENTS.motion.noun,
    value: `{spin?, swing?, slide?} in the Segment's local frame, applied spin→swing→slide. spin {axis {x,y,z}, pivot {x,y,z}, speed (rad/s, signed), startAngle?}. swing {axis, pivot, amplitude (rad each way), period (s, full cycle), easing (${MOTION_EASINGS.join("|")}), pause? (s held each end), phase? (0-1)}. slide {offset {x,y,z} to the far pose, period, easing, pause?, phase?}.`,
  },
  conveyor: {
    noun: ATTACHMENTS.conveyor.noun,
    value: `{preset (${CONVEYOR_PRESETS.join("|")}), angle} — angle is the belt's yaw radians in the Segment's local frame, 0 = module forward (-Z, toward the exit side). The whole Asset carries whoever stands on it.`,
  },
  ice: { noun: ATTACHMENTS.ice.noun, value: "exactly true — the whole deck skates. One deck one Surface: refused beside mud/bounce." },
  mud: { noun: ATTACHMENTS.mud.noun, value: "exactly true — the whole deck drags. One deck one Surface: refused beside ice/bounce." },
  bounce: {
    noun: ATTACHMENTS.bounce.noun,
    value: "exactly true — the whole deck is an inflatable skin. One deck one Surface: refused beside ice/mud.",
  },
  launch: {
    noun: ATTACHMENTS.launch.noun,
    value: `{height} — apex metres within ${LAUNCH_HEIGHT_MIN}..${LAUNCH_HEIGHT_MAX}. Only on a Spring (a def with launch); a placed Spring always launches.`,
  },
  prop: {
    noun: ATTACHMENTS.prop.noun,
    value: "exactly true — the Asset becomes a dynamic body physics owns. Refused beside behavioral attachments; color may ride.",
  },
  start: { noun: ATTACHMENTS.start.noun, value: "exactly true — one per Track at most. A Start stays still: refused beside motion." },
  checkpoint: {
    noun: ATTACHMENTS.checkpoint.noun,
    value: `{order (whole number from 1), respawn? {x,y,z}} — only on a checkpoint Gate (hoop/arch), each order once. Stays still: refused beside motion.`,
  },
  color: {
    noun: ATTACHMENTS.color.noun,
    value: `one of ${SEGMENT_COLORS.join(", ")} — authored hues (red/blue/green/yellow) wear their file, new hues tint flat (ADR 0113).`,
  },
};
