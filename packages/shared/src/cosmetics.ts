/**
 * Body skins (M9 ticket 15) — the Player's bean color, the first cosmetic.
 * Stored as a small int on the Account (`bodySkin`), validated here so the
 * API and any future writer share the one rule, rendered from
 * {@link BODY_SKIN_HUES} by any client holding a skin id.
 *
 * The seven tints are the Character Select screen's own stripe list, in its
 * order, plus the rig's factory look as {@link BASE_BODY_SKIN_ID} — all
 * equip for now (the screen's lock tiles are future content, not these
 * skins). Ticket 13 may gate some behind ownership — until then the rule is
 * just the range. Hues are degrees [0, 360) in the same space as the remote
 * rig tint they drive.
 */
export const BODY_SKIN_COUNT = 8;

/** The default bean — what every pre-skins Account backfills to. */
export const DEFAULT_BODY_SKIN = 0;

/**
 * The factory look — BLIP's own authored colors, explicitly untinted.
 * Appended last so every stored tint id keeps its meaning.
 */
export const BASE_BODY_SKIN_ID = 7;

/**
 * One hue per skin, in Character Select order (pink, sky, green, peach,
 * lavender, red, ice) — computed off the screen's own stripe colors, except
 * ice, which the tint's fixed saturation/lightness would otherwise merge
 * into sky: it sits nudged toward cyan so the two blues read apart. Stands
 * in for real art, like the stripes themselves.
 */
export const BODY_SKIN_HUES: readonly number[] = [330, 205, 120, 30, 260, 0, 185];

/**
 * Why `id` can't be equipped, or `undefined` when it can — an int in
 * `[0, BODY_SKIN_COUNT)` until ticket 13's ownership takes over.
 */
export const invalidBodySkinReason = (id: unknown): string | undefined => {
  if (typeof id !== "number" || !Number.isInteger(id) || id < 0 || id >= BODY_SKIN_COUNT) {
    return `bodySkin must be an integer 0–${BODY_SKIN_COUNT - 1}`;
  }
  return undefined;
};

/**
 * The hue a skin id wears: the table hue for a tint, `null` for the base
 * (factory colors — the renderer restores rather than recolors), and
 * `undefined` for anything else. The one place that knows base is not a
 * hue, so no renderer indexes {@link BODY_SKIN_HUES} with it by accident.
 */
export const bodySkinHue = (skin: number | null): number | null | undefined => {
  if (skin === BASE_BODY_SKIN_ID) return null;
  return typeof skin === "number" && Number.isInteger(skin) && skin >= 0 && skin < BODY_SKIN_HUES.length
    ? BODY_SKIN_HUES[skin]!
    : undefined;
};
