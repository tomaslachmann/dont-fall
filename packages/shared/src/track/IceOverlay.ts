import type { DeckFrame } from "./Conveyor.js";
import type { Module } from "./Module.js";

/**
 * The Surface id whose decks get the ice sheet overlay (ADR 0066) — the
 * `SURFACES` key, not a second source of truth for what ice is.
 */
export const ICE_SURFACE_ID = "ice";

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
 * One resolved ice deck for the renderers (ADR 0066; drawn as ADR 0107's
 * slab) — physics needs nothing of this (it reads the Surface off the
 * ground collider), but ice with no look is a trap, not a mechanic, so both
 * the game scene and the builder viewport stand a slab on the deck.
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
