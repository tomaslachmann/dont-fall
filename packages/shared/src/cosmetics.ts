import { levelForXp } from "./economy.js";

/**
 * Body colors (M9 ticket 15) — the Player's bean tint, the first cosmetic.
 * Stored as a small int on the Account (`color`), validated here so the API
 * and any future writer share the one rule, rendered from
 * {@link BODY_COLOR_HUES} by any client holding a color id.
 *
 * A color is one of *two* ways a bean can look, and the plainer one: an
 * equipped {@link SKINS} skin paints the whole body with authored art and
 * wins outright, so a color only ever shows on a bean wearing no skin (ADR
 * 0091). The two never blend — a tinted leopard is nobody's idea.
 *
 * The seven tints are the Character Select screen's own stripe list, in its
 * order, plus the rig's factory look as {@link BASE_BODY_COLOR_ID}. Hues are
 * degrees [0, 360) in the same space as the remote rig tint they drive.
 */
export const BODY_COLOR_COUNT = 8;

/** The default bean — what every pre-colors Account backfills to. */
export const DEFAULT_BODY_COLOR = 0;

/**
 * The factory look — BLIP's own authored body, explicitly untinted: the
 * cream base color the rig ships with (`starter-cream`'s own texture, which
 * is the model's embedded material). Appended last so every stored color id
 * keeps its meaning.
 */
export const BASE_BODY_COLOR_ID = 7;

/**
 * One hue per color, in Character Select order (pink, sky, green, peach,
 * lavender, red, ice) — computed off the screen's own stripe colors, except
 * ice, which the tint's fixed saturation/lightness would otherwise merge
 * into sky: it sits nudged toward cyan so the two blues read apart.
 */
export const BODY_COLOR_HUES: readonly number[] = [330, 205, 120, 30, 260, 0, 185];

/**
 * Why `id` can't be equipped, or `undefined` when it can — an int in
 * `[0, BODY_COLOR_COUNT)`. Colors have no unlock level: every bean can wear
 * every color, and the gated cosmetics are the skins and hats.
 */
export const invalidBodyColorReason = (id: unknown): string | undefined => {
  if (typeof id !== "number" || !Number.isInteger(id) || id < 0 || id >= BODY_COLOR_COUNT) {
    return `color must be an integer 0–${BODY_COLOR_COUNT - 1}`;
  }
  return undefined;
};

/**
 * The hue a color id wears: the table hue for a tint, `null` for the base
 * (factory look — the renderer restores rather than recolors), and
 * `undefined` for anything else. The one place that knows base is not a hue,
 * so no renderer indexes {@link BODY_COLOR_HUES} with it by accident.
 */
export const bodyColorHue = (color: number | null): number | null | undefined => {
  if (color === BASE_BODY_COLOR_ID) return null;
  return typeof color === "number" && Number.isInteger(color) && color >= 0 && color < BODY_COLOR_HUES.length
    ? BODY_COLOR_HUES[color]!
    : undefined;
};

/**
 * A skin BLIP can wear (ADR 0091): authored art painted over the whole body
 * through the rig's own UV map, the first cosmetic with real texture work.
 * Worn by at most one per Character and stored on the Account as its `id`,
 * exactly like a {@link HatDef}.
 *
 * A skin covers the body and nothing else: the eyes keep their own material,
 * a hat keeps its own colors, and the body's `color` tint is simply not
 * applied while a skin is on.
 */
export interface SkinDef {
  /** Stored on the Account and sent on the Lobby roster — never renamed once shipped. */
  id: string;
  /** What the wardrobe calls it. */
  name: string;
  /** The level (`levelForXp` of the Account's XP) it unlocks at. */
  unlockLevel: number;
}

/**
 * Every skin, in wardrobe order: cheapest unlock first. The art comes in two
 * collections (six patterned colors, six animals) and the levels are the
 * pack's own suggestion, which deliberately alternates between them — which
 * is why this one flat list, sorted by level, reads as the alternation the
 * artist intended rather than as two blocks.
 */
export const SKINS: readonly SkinDef[] = [
  { id: "starter-cream", name: "STARTER CREAM", unlockLevel: 1 },
  { id: "zebra", name: "ZEBRA", unlockLevel: 3 },
  { id: "mint-spots", name: "MINT SPOTS", unlockLevel: 4 },
  { id: "tiger", name: "TIGER", unlockLevel: 6 },
  { id: "sunset-stripes", name: "SUNSET STRIPES", unlockLevel: 8 },
  { id: "cow", name: "COW", unlockLevel: 10 },
  { id: "galaxy", name: "GALAXY", unlockLevel: 12 },
  { id: "leopard", name: "LEOPARD", unlockLevel: 14 },
  { id: "hazard-neon", name: "HAZARD NEON", unlockLevel: 16 },
  { id: "giraffe", name: "GIRAFFE", unlockLevel: 18 },
  { id: "prismatic", name: "PRISMATIC", unlockLevel: 20 },
  { id: "frog", name: "FROG", unlockLevel: 24 },
];

/** The skin `id` names, or `undefined` for anything that isn't one. */
export const skinById = (id: unknown): SkinDef | undefined =>
  typeof id === "string" ? SKINS.find((skin) => skin.id === id) : undefined;

/**
 * Why `skin` isn't something to wear at all, or `undefined` when it is: a
 * known skin id, or `null` for none — which is how a bean falls back to its
 * `color`.
 */
export const invalidSkinReason = (skin: unknown): string | undefined => {
  if (skin === null || skinById(skin)) return undefined;
  return `skin must be null or one of: ${SKINS.map((known) => known.id).join(", ")}`;
};

/** Whether an Account with `xp` has unlocked `skin`. */
export const isSkinUnlocked = (skin: SkinDef, xp: number): boolean => levelForXp(xp) >= skin.unlockLevel;

/**
 * Why an Account with `xp` can't wear `skin` yet, or `undefined` when it
 * can. Taking a skin off (`null`) is always allowed, and so is an id that
 * isn't a skin at all — that is {@link invalidSkinReason}'s to refuse.
 */
export const lockedSkinReason = (skin: string | null, xp: number): string | undefined => {
  const def = skinById(skin);
  if (!def || isSkinUnlocked(def, xp)) return undefined;
  return `${def.name} unlocks at level ${def.unlockLevel}`;
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

/**
 * The emotes a bean can do (ADR 0110) — what the rig has clips for, and
 * nothing it doesn't. An Account picks one to play (the main menu, Character
 * Select's PLAY EMOTE) and one as its victory pose (its Profile, the podium
 * when it wins). Free, like colours: no level gate.
 */
export const EMOTES = [
  { id: "win", name: "WIN" },
  { id: "shrug", name: "SHRUG" },
  { id: "sulk", name: "SULK" },
  { id: "wobble", name: "WOBBLE" },
  { id: "punch", name: "PUNCH" },
] as const;
export type EmoteId = (typeof EMOTES)[number]["id"];

/** What an Account plays before it picks: the wobble the turntable always did, and the win the podium always did. */
export const DEFAULT_EMOTE: EmoteId = "wobble";
export const DEFAULT_VICTORY_POSE: EmoteId = "win";

/** The emote `id` names, or `undefined` for anything that isn't one. */
export const emoteById = (id: unknown): (typeof EMOTES)[number] | undefined =>
  typeof id === "string" ? EMOTES.find((emote) => emote.id === id) : undefined;

/** Why `emote` isn't an emote, or `undefined` when it is. */
export const invalidEmoteReason = (emote: unknown): string | undefined =>
  emoteById(emote) ? undefined : `must be one of: ${EMOTES.map((known) => known.id).join(", ")}`;
