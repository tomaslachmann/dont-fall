import type { DeckFrame } from "./Conveyor.js";
import type { Module } from "./Module.js";

/**
 * The Surface id whose decks wear the inflatable sheet (ADR 0070) — the
 * `SURFACES` key, not a second source of truth for what bounce is.
 */
export const BOUNCE_SURFACE_ID = "bounce";

/**
 * Why `value` is not a storable Segment bounce attachment, or `undefined`
 * when it is — exactly `true` (detaching removes the key, mirroring ice and
 * mud). The API's publish validation reports this reason in its 400.
 */
export const invalidBounceReason = (value: unknown): string | undefined =>
  value === true ? undefined : "bounce must be true when present — omit it to detach";

/** Whether `value` is a storable Segment bounce attachment — see {@link invalidBounceReason}. */
export const isSegmentBounce = (value: unknown): value is true => invalidBounceReason(value) === undefined;

/**
 * The served texture file both renderers' bounce sheets share (repo
 * `assets/`, API `/assets/`) — ambientCG Plastic 016 B's Color map, CC0; see
 * the sidecar `assets/bounce_surface.txt` for provenance. The shine is the
 * material's (low roughness, high specular), not the map's.
 */
export const BOUNCE_TEXTURE_FILE = "bounce_surface.jpg";

/** World units one texture tile spans across the deck — the ice/mud pitch, so the three sheets read at one scale. */
export const BOUNCE_TILE_WORLD = 2;

/**
 * How many quads the sheet is cut into along each axis. The dome and every
 * dent are vertex work, so this is the resolution of the whole effect: too
 * few and a dent has corners, too many and a big deck costs a mesh nobody
 * looks at that closely. Shared so the builder preview and the game cut the
 * same cloth.
 */
export const BOUNCE_SHEET_SEGMENTS = 24;

/** How far above the deck top the sheet's rim sits — clear of the belt chevrons, like ice. */
export const BOUNCE_OVERLAY_LIFT = 0.02;

/**
 * How far from the deck a Character's feet may be and still press the sheet
 * (units). Beyond this it is someone jumping overhead, not someone arriving,
 * and the sheet should not answer.
 *
 * Kept above {@link BOUNCE_DOME_RISE} on purpose: the skin has to be giving
 * way by the time the feet reach its highest point, or a Character visibly
 * falls through the top of the dome before anything happens.
 */
export const BOUNCE_PRESS_HEIGHT = 0.95;

/**
 * One resolved bounce sheet for the renderers (ADR 0070) — same contract as
 * `IceDeck`/`MudDeck`: physics reads the Surface off the ground collider and
 * needs nothing of this, but a deck that throws you back and looks like
 * concrete is a trap, not a mechanic.
 */
export interface BounceDeck {
  /** Which Segment wears this sheet — the game client re-parents it under a Moving Segment's own group. */
  segmentIndex: number;
  /** Where the sheet lies. */
  deck: DeckFrame;
}

/** Whether a Module's deck reads as bounce — the same collapse `moduleHasIceSurface` asks (ADR 0066). */
export const moduleHasBounceSurface = (module: Module): boolean => {
  if (module.statics.some((box) => (box.surface ?? module.surface) === BOUNCE_SURFACE_ID)) return true;
  if ((module.asset?.meshes ?? []).some((mesh) => mesh.surface === BOUNCE_SURFACE_ID)) return true;
  if ((module.asset?.solid ?? []).some((part) => part.surface === BOUNCE_SURFACE_ID)) return true;
  return false;
};

// --- The shape of the thing -------------------------------------------------
//
// The sheet is drawn, never simulated (ADR 0070): the deck's collider stays
// the flat box it always was, and everything below only moves vertices. The
// maths lives here, in shared, so the builder's preview and the game draw the
// same skin the same way — the `motionPose` discipline (ADR 0061) applied to a
// surface instead of a Segment.

/**
 * How far the middle of an untouched sheet stands above the deck top (units).
 *
 * Properly pumped: at a fifth of a unit the skin read as a rubber mat lying on
 * the floor rather than as something full of air, and at half a unit it was
 * still short of it (user, 2026-09-15, twice). Against a Character 1.7 units
 * tall this stands knee-high in the middle, which is where a bouncy castle's
 * skin actually sits.
 */
export const BOUNCE_DOME_RISE = 0.7;

/**
 * How deep a Character standing still presses it, and how wide that press
 * reaches (units).
 *
 * The depth is deliberately a shade *more* than {@link BOUNCE_DOME_RISE}:
 * under the feet the two cancel, so the skin lands just below the flat deck
 * the Character is really standing on. Raise one and the other has to follow,
 * or the dome starts swallowing everyone up to the ankles.
 */
export const BOUNCE_PRESS_DEPTH = 0.78;
export const BOUNCE_PRESS_RADIUS = 1.4;

/** How much deeper a landing presses, per unit of impact speed, and the cap on that. */
export const BOUNCE_IMPACT_PER_SPEED = 0.035;
export const BOUNCE_IMPACT_MAX = 0.65;

/** How long the sheet rings after a landing, and how fast it rings (Hz). */
export const BOUNCE_WOBBLE_MS = 620;
export const BOUNCE_WOBBLE_HZ = 4.5;

/**
 * How much of the sheet's movement survives at `u`,`v` — the deck's own
 * normalised coordinates, each in [-1, 1] from centre to rim.
 *
 * Every vertical term below is multiplied by this, which pins the rim to the
 * deck by construction: the sheet is stitched to its frame all the way round,
 * so neither the dome nor a Character standing on the very edge can lift or
 * push the border off the deck it belongs to.
 */
export const bounceEdgeMask = (u: number, v: number): number => {
  const inside = Math.max(0, 1 - u * u) * Math.max(0, 1 - v * v);
  return inside;
};

/**
 * The sheet's profile at `u`,`v` — 0 at the rim, 1 in the middle, and the
 * shape of everything in between.
 *
 * `1 - (1 - mask)²` rather than the mask itself: an inflated thing is fat and
 * nearly flat across its top and does its bending near the edge, where the
 * skin is pulled down to its frame. The plain mask peaks to a point in the
 * middle, which reads as a tent. The slope stays finite at the rim (unlike a
 * square root, which would crease there).
 *
 * The dome and every press are both shaped by this, so they cancel the same
 * way everywhere: a Character standing near the edge sinks to the deck just
 * like one standing dead centre.
 */
export const bounceProfile = (u: number, v: number): number => {
  const mask = bounceEdgeMask(u, v);
  return mask * (2 - mask);
};

/** The rest shape: taut and convex, fat across the top, flush at the rim. */
export const bounceDomeLift = (u: number, v: number): number => BOUNCE_DOME_RISE * bounceProfile(u, v);

/**
 * How much a press `distance` units away reaches this point — a smooth
 * cosine hump that is exactly zero at {@link BOUNCE_PRESS_RADIUS}, so a
 * Character's dent has a definite edge instead of a long numerical tail
 * across the whole sheet.
 */
export const bouncePressFalloff = (distance: number): number => {
  if (distance >= BOUNCE_PRESS_RADIUS) return 0;
  return (1 + Math.cos((Math.PI * distance) / BOUNCE_PRESS_RADIUS)) / 2;
};

/**
 * The extra depth a landing at `impactSpeed` (units/s, positive) presses,
 * `msSince` after it hit — a damped oscillation, so the sheet dips hard,
 * throws back past its rest shape, and rings down to nothing.
 *
 * Positive is *down*. The first half-cycle is the dent; the negative lobes
 * that follow are the sheet standing prouder than its own dome, which is the
 * whole read of an inflatable throwing someone off it.
 */
export const bounceWobble = (msSince: number, impactSpeed: number): number => {
  if (msSince < 0 || msSince >= BOUNCE_WOBBLE_MS) return 0;
  const amplitude = Math.min(BOUNCE_IMPACT_MAX, Math.abs(impactSpeed) * BOUNCE_IMPACT_PER_SPEED);
  const t = msSince / 1000;
  // Decay chosen so the ring is visually over by BOUNCE_WOBBLE_MS rather than
  // merely small — the tail is cut by the guard above, and a cut that lands
  // near zero anyway never shows as a step.
  const decay = Math.exp((-5 * msSince) / BOUNCE_WOBBLE_MS);
  return amplitude * decay * Math.cos(2 * Math.PI * BOUNCE_WOBBLE_HZ * t);
};
