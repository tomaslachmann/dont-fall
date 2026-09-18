/**
 * How an ice deck looks (ADR 0107) — render-only numbers, so they live beside
 * the code that draws them rather than with the simulation's tuning. Nothing
 * that simulates reads any of this: a Character still stands on the deck's
 * own collider, and the ice is a slab drawn over it.
 *
 * The look is a toy's, like the mud's (ADR 0103), from the user's choices on
 * 2026-09-18: a thick opaque pastel slab with a visible edge, cut square over
 * the bevel so neighbouring ice joins; cracks and frozen bubbles drawn in it;
 * frostier at its free edges; and the occasional sparkle glint.
 */

/** How tall the slab stands above its deck — a frozen layer, thinner than the mud it stands beside. */
export const ICE_DEPTH = 0.1;

/**
 * The palette: opaque pastel blue-white, lighter than any floor so it reads
 * as ice at a glance. The top mixes broad soft blotches of these three; the
 * cut side is the slab seen edge-on, whiter at its lip and falling into a
 * deeper blue at its foot.
 */
export const ICE_COLOR_DEEP = 0x9fcbe4;
export const ICE_COLOR_BASE = 0xc3e2f2;
export const ICE_COLOR_LIGHT = 0xe3f3fb;
/** The crack veins, and the frost at a free edge: nearly white. */
export const ICE_COLOR_CRACK = 0xf6fcff;
export const ICE_COLOR_FROST = 0xeef8fd;
export const ICE_SIDE_COLOR = 0xd9eef9;
export const ICE_SIDE_FOOT_COLOR = 0x8ab8d6;

/** How big the broad tone blotches across the top are (world metres). */
export const ICE_BLOTCH_SIZE = 2.0;

/** How wide the frost band along a free edge is (metres) — the "whiter edges" of the user's pick. */
export const ICE_RIM_WIDTH = 0.55;

/**
 * The body's sheen: glossy — the environment map is what makes it read as
 * ice under every preset. The cut side is a touch rougher, frost over glass.
 */
export const ICE_BODY_ROUGHNESS = 0.18;
export const ICE_SIDE_ROUGHNESS = 0.42;

/**
 * The cracks (drawn in the world-tiled detail texture, not per vertex — a
 * vein is far thinner than any sane vertex grid): borders of a jittered cell
 * pattern, a bright thin core inside a soft halo. Cell size and the tile the
 * pattern repeats on are world metres; the pattern is periodic per tile so
 * the texture wraps, and anchored to world space so it runs on across a seam.
 */
export const ICE_DETAIL_TILE = 3;
export const ICE_CRACK_CELL = 0.9;
export const ICE_CRACK_WIDTH = 0.028;
export const ICE_CRACK_HALO = 0.11;
export const ICE_CRACK_ALPHA = 0.85;
export const ICE_CRACK_HALO_ALPHA = 0.22;

/**
 * The frozen bubbles: small pale specks scattered in the same detail
 * texture, each its own size and its own depth — the deeper, the fainter.
 */
export const ICE_SPECK_CELL = 0.28;
export const ICE_SPECK_CHANCE = 0.45;
export const ICE_SPECK_RADIUS_MIN = 0.012;
export const ICE_SPECK_RADIUS_MAX = 0.045;
export const ICE_SPECK_ALPHA_MAX = 0.5;

/** The detail texture's resolution — one tile of cracks and specks. */
export const ICE_DETAIL_SIZE = 384;

/**
 * The glints (the user's pick over a travelling sheen): a sparkle star pops
 * on a spot for a moment, then nothing until its next period. On a grid
 * across the deck like the mud's bubbles, a share of cells holding one.
 */
export const ICE_GLINT_SPACING = 1.3;
export const ICE_GLINT_CHANCE = 0.5;
export const ICE_GLINT_SIZE_MIN = 0.07;
export const ICE_GLINT_SIZE_MAX = 0.14;
export const ICE_GLINT_PERIOD_MIN = 3.5;
export const ICE_GLINT_PERIOD_MAX = 9;
/** How long one sparkle lasts (seconds of its period). */
export const ICE_GLINT_FLASH_SECONDS = 0.6;
/** No glint closer than this to a free edge. */
export const ICE_GLINT_INSET = 0.2;
export const ICE_GLINT_COLOR = 0xffffff;

/** How far above the deck top the whole slab is seated, so its cut side never fights the deck for depth. */
export const ICE_SEAT_LIFT = 0.004;
