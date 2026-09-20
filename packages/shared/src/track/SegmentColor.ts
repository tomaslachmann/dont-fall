/**
 * A Segment's paint: the 8 hues a colored Asset family wears. KayKit ships
 * every colored shape in 4 files (`_red`/`_blue`/`_green`/`_yellow` — same
 * texture bytes, different UVs, measured off the GLBs); the builder shows
 * each shape once, under its canonical `_red` file, and paint works the way
 * the character's does (ADR 0091/0113): an authored hue wears its own file
 * outright, a new hue tints the placed file flat. The 4 originals are all in
 * the set, and `red` on the canonical is the file itself.
 *
 * Target hues are first guesses for live tuning — no rasterised check exists
 * in this repo.
 */
export const SEGMENT_COLORS = [
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "purple",
  "pink",
] as const;

/** One of {@link SEGMENT_COLORS} — what a Segment's `color` Attachment stores. */
export type SegmentColorId = (typeof SEGMENT_COLORS)[number];

/** Paint hue per color, in degrees — the picker's stripes and a flat tint's aim. */
export const SEGMENT_COLOR_HUES: Record<SegmentColorId, number> = {
  red: 0,
  orange: 32,
  yellow: 55,
  green: 145,
  cyan: 190,
  blue: 220,
  purple: 275,
  pink: 335,
};

/**
 * The color a fresh placement wears: the canonical file's own, so a Segment
 * placed and never touched draws the file itself (no variant at all).
 */
export const DEFAULT_SEGMENT_COLOR: SegmentColorId = "red";

/** Whether `value` is a storable Segment color. */
export const isSegmentColorId = (value: unknown): value is SegmentColorId =>
  typeof value === "string" && (SEGMENT_COLORS as readonly string[]).includes(value);

/**
 * Why `value` is not a storable Segment color, or `undefined` when it is —
 * the reason a refused publish reports (a Revision is immutable, ADR 0032).
 */
export const invalidSegmentColorReason = (value: unknown): string | undefined =>
  isSegmentColorId(value)
    ? undefined
    : `color must be one of ${SEGMENT_COLORS.join(", ")}, got ${JSON.stringify(value)}`;
