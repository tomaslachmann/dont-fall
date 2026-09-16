import type { DeckFrame } from "./Conveyor.js";
import type { Module } from "./Module.js";

/**
 * The Surface id whose decks get the ice sheet overlay (ADR 0066) — the
 * `SURFACES` key, not a second source of truth for what ice is.
 */
export const ICE_SURFACE_ID = "ice";

/**
 * The served texture file both renderers' ice sheets share (repo `assets/`,
 * API `/assets/`) — ambientCG Ice 003's Color map, CC0; see the sidecar
 * `assets/ice_surface.txt` for provenance.
 */
export const ICE_TEXTURE_FILE = "ice_surface.jpg";

/**
 * Why `value` is not a storable Segment ice attachment, or `undefined` when
 * it is — exactly `true` (detaching removes the key, mirroring the belt).
 * The API's publish validation reports this reason in its 400 (a Revision
 * is immutable, so malformed ice must fail at publish, not in a Match);
 * {@link isSegmentIce} is the boolean half over the same definition, so the
 * two can never disagree about what attached ice is.
 */
export const invalidIceReason = (value: unknown): string | undefined =>
  value === true ? undefined : "ice must be true when present — omit it to detach";

/** Whether `value` is a storable Segment ice attachment — see {@link invalidIceReason}. */
export const isSegmentIce = (value: unknown): value is true => invalidIceReason(value) === undefined;

/**
 * World units one texture tile spans across the deck — both renderers
 * repeat the seamless map on this pitch, so a sheet reads identically in
 * the game and the builder. 1K pixels over 2 units: crisp underfoot, never
 * inspected up close.
 */
export const ICE_TILE_WORLD = 2;

/**
 * Sheet opacity — the deck's own art stays visible through the ice, like a
 * frozen film over it rather than a replacement floor.
 */
export const ICE_OVERLAY_OPACITY = 0.65;

/**
 * Lift above the deck top: below the conveyor chevrons' own lift, so a
 * belt running on ice still marches visibly above the sheet.
 */
export const ICE_OVERLAY_LIFT = 0.01;

/**
 * One resolved ice sheet for the renderers (ADR 0066) — physics needs
 * nothing of this (it reads the Surface off the ground collider), but ice
 * with no look is a trap, not a mechanic, so both the game scene and the
 * builder viewport sheet the deck in ice.
 */
export interface IceDeck {
  /** Which Segment wears this sheet — the game client re-parents it under a Moving Segment's own group. */
  segmentIndex: number;
  /** Where the sheet lies. */
  deck: DeckFrame;
}

/**
 * Whether a Module's deck reads as ice (ADR 0066) — any floor piece whose
 * Surface resolves to ice (`Box.surface ?? Module.surface`, exactly like
 * `resolveTrack`'s own collapse), or any validated asset mesh/solid part
 * carrying ice. The sheet covers the whole
 * footprint, so one icy piece sheets the deck: mixed-deck precision (an icy
 * box among default ones) belongs to a per-box overlay, not this sheet —
 * and no Module authors one today. The single rule `resolveTrack` and the
 * builder both ask, so the game and the viewport can never disagree about
 * which decks are icy.
 */
export const moduleHasIceSurface = (module: Module): boolean => {
  if (module.statics.some((box) => (box.surface ?? module.surface) === ICE_SURFACE_ID)) return true;
  // Validated asset geometry carries its Surface already resolved (the
  // validator applied the same `?? Module` collapse at attach time).
  if ((module.asset?.meshes ?? []).some((mesh) => mesh.surface === ICE_SURFACE_ID)) return true;
  if ((module.asset?.solid ?? []).some((part) => part.surface === ICE_SURFACE_ID)) return true;
  return false;
};
