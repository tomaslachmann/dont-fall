import type { DeckFrame } from "./Conveyor.js";
import type { Module } from "./Module.js";

/**
 * The Surface id whose decks are drawn as mud (ADR 0067) — the
 * `SURFACES` key, not a second source of truth for what mud is.
 */
export const MUD_SURFACE_ID = "mud";

/**
 * One resolved mud deck for the renderers (ADR 0067) — physics needs nothing
 * of this (it reads the Surface off the ground collider), but mud with no look
 * is a trap, not a mechanic, so both the game scene and the builder viewport
 * draw it. How it looks is `@dont-fall/render`'s business (ADR 0103).
 */
export interface MudDeck {
  /** Which Segment this deck is — the game client re-parents its mud under a Moving Segment's own group. */
  segmentIndex: number;
  /** Where the deck lies. */
  deck: DeckFrame;
}

/**
 * Why `value` is not a storable Segment mud attachment, or `undefined` when
 * it is — exactly `true` (detaching removes the key, mirroring the belt).
 * The API's publish validation reports this reason in its 400 (a Revision
 * is immutable, so malformed mud must fail at publish, not in a Match);
 * {@link isSegmentMud} is the boolean half over the same definition, so the
 * two can never disagree about what attached mud is.
 */
export const invalidMudReason = (value: unknown): string | undefined =>
  value === true ? undefined : "mud must be true when present — omit it to detach";

/** Whether `value` is a storable Segment mud attachment — see {@link invalidMudReason}. */
export const isSegmentMud = (value: unknown): value is true => invalidMudReason(value) === undefined;

/**
 * Whether a Module's deck reads as mud (ADR 0067) — any floor piece whose
 * Surface resolves to mud (`Box.surface ?? Module.surface`, exactly like
 * `resolveTrack`'s own collapse), or any validated asset mesh/solid part
 * carrying mud. The mud covers the whole deck, so one muddy piece muds the
 * deck: mixed-deck precision belongs to a per-box overlay, not this one —
 * and no Module authors one today. The single rule
 * `resolveTrack` and the builder both ask, so the game and the viewport can
 * never disagree about which decks are muddy.
 */
export const moduleHasMudSurface = (module: Module): boolean => {
  if (module.statics.some((box) => (box.surface ?? module.surface) === MUD_SURFACE_ID)) return true;
  // Validated asset geometry carries its Surface already resolved (the
  // validator applied the same `?? Module` collapse at attach time).
  if ((module.asset?.meshes ?? []).some((mesh) => mesh.surface === MUD_SURFACE_ID)) return true;
  if ((module.asset?.solid ?? []).some((part) => part.surface === MUD_SURFACE_ID)) return true;
  return false;
};
