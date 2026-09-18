/**
 * How a mud deck looks (ADR 0103) — render-only numbers, so they live beside
 * the code that draws them rather than with the simulation's tuning. Nothing
 * that simulates reads any of this: a Character still stands on the deck's
 * own collider, and the mud is a mass drawn over it that its feet sink into.
 *
 * The look is a toy's, not a documentary's (the user, 2026-09-18: "vizuálně
 * hezké, fall guys style, hrudkovité, bublat místo kaluží, bez zaoblených
 * okrajů"): a thick chocolate mass heaped into clods, cut square at the edge
 * of the deck it sits on, with bubbles swelling and popping in it.
 */

/** How far the mud between the clods stands above its deck — feet sink to the ankle before a clod takes them to the shin. */
export const MUD_DEPTH = 0.16;

/** A slow swell under the clods, so a big deck is not one even carpet of them: how tall, and how far apart (world metres). */
export const MUD_SWELL_HEIGHT = 0.04;
export const MUD_SWELL_SIZE = 2.6;

/**
 * The clods: soft domes heaped on the mass, one to a cell of a jittered world
 * grid, merged where they meet the way dollops of something thick do. How far
 * apart, how wide and how tall — the tallest is what the top of the mud is.
 */
export const MUD_CLOD_SPACING = 0.75;
export const MUD_CLOD_RADIUS_MIN = 0.3;
export const MUD_CLOD_RADIUS_MAX = 0.52;
export const MUD_CLOD_HEIGHT_MIN = 0.06;
export const MUD_CLOD_HEIGHT_MAX = 0.12;
/** How softly two clods that meet run into each other (metres of blend): a crease, never a cut. */
export const MUD_CLOD_BLEND = 0.035;

/** The broad tones across the top: how big a blotch is (world metres). */
export const MUD_BLOTCH_SIZE = 2.2;

/**
 * The palette: a saturated milk chocolate, darker than the plastic panels so
 * it reads as the hazard, never so dark it reads as a hole. Clod tops catch a
 * caramel crest; the creases between them sink a shade deeper; the cut side
 * is the body in its own shadow.
 */
export const MUD_COLOR_DEEP = 0x3b1c0d;
export const MUD_COLOR_DARK = 0x4f2814;
export const MUD_COLOR_BASE = 0x6c3a1d;
export const MUD_COLOR_LIGHT = 0x87502b;
export const MUD_COLOR_CREST = 0xa9693c;
export const MUD_SIDE_COLOR = 0x3a1c0e;
/** The side darkens toward the deck, where no light gets under the mass. */
export const MUD_SIDE_FOOT_COLOR = 0x26120a;

/** The body's sheen: wet and thick, glossy enough for a highlight to slide over a clod. */
export const MUD_BODY_ROUGHNESS = 0.4;

/**
 * Bubbles: on a grid across the deck, a share of its cells hold a spot where
 * one swells out of the mud, pops, and leaves a ring that sinks back in —
 * then the next one. How far apart, how many, how big, how often.
 */
export const MUD_BUBBLE_SPACING = 1.5;
export const MUD_BUBBLE_CHANCE = 0.55;
export const MUD_BUBBLE_RADIUS_MIN = 0.07;
export const MUD_BUBBLE_RADIUS_MAX = 0.15;
export const MUD_BUBBLE_PERIOD_MIN = 1.8;
export const MUD_BUBBLE_PERIOD_MAX = 3.6;
/** The share of a bubble's cycle spent swelling; it pops at the end of it. */
export const MUD_BUBBLE_SWELL = 0.72;
/** The share of the cycle the ring it leaves takes to spread and sink. */
export const MUD_BUBBLE_RING = 0.2;
/** How far the ring spreads, as a multiple of the bubble's own radius. */
export const MUD_BUBBLE_RING_SPREAD = 2.6;
/** No bubble closer than this to a free edge — it would hang off the cut side. */
export const MUD_BUBBLE_INSET = 0.35;
export const MUD_BUBBLE_COLOR = 0x7a4524;
export const MUD_BUBBLE_ROUGHNESS = 0.15;
export const MUD_RING_COLOR = 0x5c2f17;

/**
 * How finely the top is cut: about this far between vertices, but never more
 * than {@link MUD_GRID_MAX_CELLS} across a deck — a big deck keeps its clods
 * at the cost of a coarser grid instead of an unbounded mesh.
 */
export const MUD_GRID_SPACING = 0.15;
export const MUD_GRID_MAX_CELLS = 80;

/** How far above the deck top the whole mass is seated, so its cut side never fights the deck for depth. */
export const MUD_SEAT_LIFT = 0.004;

/**
 * Wading: where a Character's feet are in the mud, the surface gives way and
 * slowly fills back in behind them. How deep, how wide, how fast it presses
 * and how long it takes to fill.
 */
export const MUD_DENT_DEPTH = 0.1;
export const MUD_DENT_RADIUS = 0.5;
export const MUD_DENT_PRESS_SECONDS = 0.1;
export const MUD_DENT_REFILL_SECONDS = 1.6;
/** How often a Character standing in the mud presses a fresh dent — a trail, not a strobe. */
export const MUD_DENT_INTERVAL_SECONDS = 0.12;
/** Live dents per deck; a crowd steals the oldest. */
export const MUD_DENT_POOL_SIZE = 48;
/** Feet further above the mud than this are jumping over it, and press nothing. */
export const MUD_DENT_ABOVE = 0.25;
/** The lowest the surface ever goes — a dent's bottom — so it never opens onto the deck. */
export const MUD_FLOOR = 0.02;
