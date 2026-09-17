import { levelForXp } from "./economy.js";

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

/**
 * A hat BLIP can wear (ADR 0083): the first cosmetic with its own art,
 * rigid, on the head bone. Worn by at most one per Character, stored on the
 * Account as its `id`.
 */
export interface HatDef {
  /** Stored on the Account and sent on the Lobby roster — never renamed once shipped. */
  id: string;
  /** What the wardrobe calls it. */
  name: string;
  /** The level (`levelForXp` of the Account's XP) it unlocks at. */
  unlockLevel: number;
  /** Whether it covers BLIP's crest, which the rig then tucks into the head. The crown leaves it showing. */
  coversCrest: boolean;
}

/**
 * Every hat, in wardrobe order: cheapest unlock first. The levels are the
 * art pack's own suggestion (`BLIP_Cosmetics_v1`), kept as data so tuning
 * them is an edit here and nowhere else.
 */
export const HATS: readonly HatDef[] = [
  { id: "cone", name: "TRAFFIC CONE", unlockLevel: 2, coversCrest: true },
  { id: "pot", name: "POT", unlockLevel: 5, coversCrest: true },
  { id: "bucket", name: "BUCKET", unlockLevel: 9, coversCrest: true },
  { id: "propeller-cap", name: "PROPELLER CAP", unlockLevel: 14, coversCrest: true },
  { id: "crown", name: "CROWN", unlockLevel: 20, coversCrest: false },
  { id: "ufo", name: "UFO", unlockLevel: 30, coversCrest: true },
];

/** The hat `id` names, or `undefined` for anything that isn't one. */
export const hatById = (id: unknown): HatDef | undefined =>
  typeof id === "string" ? HATS.find((hat) => hat.id === id) : undefined;

/**
 * Why `hat` isn't something to wear at all, or `undefined` when it is: a
 * known hat id, or `null` for none.
 */
export const invalidHatReason = (hat: unknown): string | undefined => {
  if (hat === null || hatById(hat)) return undefined;
  return `hat must be null or one of: ${HATS.map((known) => known.id).join(", ")}`;
};

/** Whether an Account with `xp` has unlocked `hat`. */
export const isHatUnlocked = (hat: HatDef, xp: number): boolean => levelForXp(xp) >= hat.unlockLevel;

/**
 * Why an Account with `xp` can't wear `hat` yet, or `undefined` when it can.
 * Taking a hat off (`null`) is always allowed, and so is an id that isn't a
 * hat at all — that is {@link invalidHatReason}'s to refuse.
 */
export const lockedHatReason = (hat: string | null, xp: number): string | undefined => {
  const def = hatById(hat);
  if (!def || isHatUnlocked(def, xp)) return undefined;
  return `${def.name} unlocks at level ${def.unlockLevel}`;
};

/**
 * The hats an Account unlocked by going from `xpBefore` to `xpAfter`, in
 * wardrobe order — what the Rewards screen announces after a Match.
 */
export const hatsUnlockedBetween = (xpBefore: number, xpAfter: number): HatDef[] =>
  HATS.filter((hat) => !isHatUnlocked(hat, xpBefore) && isHatUnlocked(hat, xpAfter));
