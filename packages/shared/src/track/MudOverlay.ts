import type { DeckFrame } from "./Conveyor.js";
import type { Module } from "./Module.js";

/**
 * The Surface id whose decks get the mud sheet overlay (ADR 0067) — the
 * `SURFACES` key, not a second source of truth for what mud is.
 */
export const MUD_SURFACE_ID = "mud";

/**
 * The served texture file both renderers' mud sheets share (repo `assets/`,
 * API `/assets/`) — ambientCG Ground 094 C's Color map, CC0; see the
 * sidecar `assets/mud_surface.txt` for provenance.
 */
export const MUD_TEXTURE_FILE = "mud_surface.jpg";

/**
 * World units one texture tile spans across the deck — both renderers
 * repeat the seamless map on this pitch, so a sheet reads identically in
 * the game and the builder. 1K pixels over 2 units: crisp underfoot, never
 * inspected up close.
 */
export const MUD_TILE_WORLD = 2;

/**
 * Height of the mud mass above the deck top: ankle-deep on a 1.7-unit
 * Character, so feet sink slightly into the mud while the physics keeps
 * colliding with the deck itself. A filled block, not a floating plane —
 * the gap between the deck and the mud surface is mud, so both renderers
 * draw the sides down to the deck top. Above the conveyor chevrons' own
 * lift — a belt running under mud reads as covered, which is what it is.
 * (Both renderers lay mud opaque — a translucent layer would show the
 * feet through instead of sinking them.)
 */
export const MUD_OVERLAY_LIFT = 0.08;

/**
 * Cut-earth brown for the filled block's four sides (and its never-seen
 * bottom) — `mud_surface.jpg`'s own average (`#716454`, sampled) darkened
 * to 0.6, so the mass reads as the same mud sitting in its own shadow.
 */
export const MUD_SIDE_COLOR = 0x443c32;

/** Wet-sheen ripple color — the texture average lightened toward white, so a ring reads as disturbed mud, not a decal. */
export const MUD_RIPPLE_COLOR = 0xaaa298;

/**
 * Idle slosh amplitude in UV units (~6 cm on the 2-unit tile) — the mud
 * surface never sits still. An oscillation, deliberately NOT a march: a
 * marching texture reads as flow, a second conveyor; mud is sticky, so it
 * breathes in place instead.
 */
export const MUD_SLOSH_AMPLITUDE_UV = 0.03;
/** Slosh periods per axis — coprime-ish, so the motion never visibly loops. */
export const MUD_SLOSH_PERIOD_U_SECONDS = 5.2;
export const MUD_SLOSH_PERIOD_V_SECONDS = 6.7;
/** Per-segment phase stagger (`segmentIndex * step`) — neighbouring sheets never breathe in sync. */
export const MUD_SLOSH_PHASE_STEP = 2.1;

/** A slosh sample — added to the sheet texture's own repeat offset each frame. */
export interface MudSloshOffset {
  u: number;
  v: number;
}

/**
 * Where the mud surface has breathed to at `tSeconds` — two slow sines on
 * different periods with a fixed inter-axis stagger, so the drift wanders
 * instead of tracing a line. Pure in `(t, phase)`: the game and the builder
 * pose the same breath from their own clocks.
 */
export const mudSloshOffset = (tSeconds: number, phase: number): MudSloshOffset => ({
  u: MUD_SLOSH_AMPLITUDE_UV * Math.sin((tSeconds / MUD_SLOSH_PERIOD_U_SECONDS) * Math.PI * 2 + phase),
  v: MUD_SLOSH_AMPLITUDE_UV * Math.sin((tSeconds / MUD_SLOSH_PERIOD_V_SECONDS) * Math.PI * 2 + phase + Math.PI / 3),
});

/** Slowest rate the sheet answers feet standing in it — a ring per Character, a few times a second, never a strobe. */
export const MUD_RIPPLE_INTERVAL_SECONDS = 0.28;
/** One ring's whole life — expand and fade, then the pool slot frees. */
export const MUD_RIPPLE_LIFETIME_SECONDS = 0.9;
/** A ring is born at boot size and dies past arm's reach — the walk stays readable without flooding the deck. */
export const MUD_RIPPLE_MIN_RADIUS = 0.12;
export const MUD_RIPPLE_MAX_RADIUS = 0.55;
/** A fresh ring's opacity — present, never a headlight. */
export const MUD_RIPPLE_OPACITY = 0.55;
/** Rings ride just above the mud top — clear of it, below nothing. */
export const MUD_RIPPLE_LIFT = 0.003;
/** Live rings per sheet — a full lobby crossing one deck still fits. */
export const MUD_RIPPLE_POOL_SIZE = 8;
/**
 * Feet tolerance above the mud surface — a Character jumping OVER the mud
 * ripples nothing; only feet at (or below) the surface disturb it. Read in
 * the sheet's own local frame, so moving carriers work with no extra math.
 */
export const MUD_RIPPLE_ABOVE_LIFT = 0.15;

/** One live ring's draw state — the renderers scale a unit ring and fade its material from this. */
export interface MudRipplePose {
  radius: number;
  opacity: number;
}

/**
 * A ring born `ageSeconds` ago — linear expand, linear fade. `null` once
 * the lifetime is spent (or the age is nonsense): the ring is gone, free
 * the pool slot. Pure in the age, so both renderers retire rings
 * identically — though only the game spawns them (the builder previews no
 * Characters).
 */
export const mudRipplePose = (ageSeconds: number): MudRipplePose | null => {
  if (!(ageSeconds >= 0) || ageSeconds >= MUD_RIPPLE_LIFETIME_SECONDS) return null;
  const k = ageSeconds / MUD_RIPPLE_LIFETIME_SECONDS;
  return {
    radius: MUD_RIPPLE_MIN_RADIUS + (MUD_RIPPLE_MAX_RADIUS - MUD_RIPPLE_MIN_RADIUS) * k,
    opacity: MUD_RIPPLE_OPACITY * (1 - k),
  };
};

/**
 * One resolved mud sheet for the renderers (ADR 0067) — physics needs
 * nothing of this (it reads the Surface off the ground collider), but mud
 * with no look is a trap, not a mechanic, so both the game scene and the
 * builder viewport sheet the deck in mud.
 */
export interface MudDeck {
  /** Which Segment wears this sheet — the game client re-parents it under a Moving Segment's own group. */
  segmentIndex: number;
  /** Where the sheet lies. */
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
 * carrying mud. The sheet covers the whole footprint, so one muddy piece
 * sheets the deck: mixed-deck precision belongs to a per-box overlay, not
 * this sheet — and no Module authors one today. The single rule
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
