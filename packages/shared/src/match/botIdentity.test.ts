import { describe, expect, it } from "vitest";
import { BODY_COLOR_COUNT, HATS, SKINS } from "../cosmetics.js";
import { NICKNAME_MAX_LENGTH } from "../net/protocol.js";
import { BOT_NICKNAMES, botIdentities } from "./botIdentity.js";

describe("botIdentities (M17 ticket 10, ADR 0129)", () => {
  it("draws the same Bots from the same seed, and other Bots from another", () => {
    expect(botIdentities("match-a:120", 11)).toEqual(botIdentities("match-a:120", 11));
    expect(botIdentities("match-a:120", 11)).not.toEqual(botIdentities("match-a:121", 11));
  });

  it("names every Bot from the list, never twice, and never after someone already in the Lobby", () => {
    const taken = ["PIXELPEACH", "Tomik"];
    const bots = botIdentities("seed", 11, taken);
    const names = bots.map((bot) => bot.nickname);
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(11);
    for (const name of names) {
      expect(BOT_NICKNAMES).toContain(name);
      expect(taken.map((t) => t.toLowerCase())).not.toContain(name.toLowerCase());
    }
  });

  it("still names a Lobby bigger than the list uniquely", () => {
    const names = botIdentities("seed", BOT_NICKNAMES.length + 5).map((bot) => bot.nickname.toLowerCase());
    expect(new Set(names).size).toBe(BOT_NICKNAMES.length + 5);
    expect(Math.max(...names.map((name) => name.length))).toBeLessThanOrEqual(NICKNAME_MAX_LENGTH);
  });

  it("dresses each Bot in a Colour or a Skin, never both, and a Hat, all from the whole catalogue", () => {
    const bots = botIdentities("wardrobe", 200);
    for (const bot of bots) {
      expect((bot.color === null) !== (bot.skin === null)).toBe(true);
      if (bot.color !== null) expect(bot.color).toBeGreaterThanOrEqual(0);
      if (bot.color !== null) expect(bot.color).toBeLessThan(BODY_COLOR_COUNT);
      if (bot.skin !== null) expect(SKINS.map((skin) => skin.id)).toContain(bot.skin);
      expect(HATS.map((hat) => hat.id)).toContain(bot.hat);
    }
    // Both looks, and the locked end of the wardrobe too: a Bot has no level.
    expect(bots.some((bot) => bot.skin !== null) && bots.some((bot) => bot.color !== null)).toBe(true);
    expect(new Set(bots.map((bot) => bot.hat)).size).toBe(HATS.length);
  });

  it("every listed name fits a roster row", () => {
    for (const name of BOT_NICKNAMES) expect(name.length).toBeLessThanOrEqual(NICKNAME_MAX_LENGTH);
    expect(new Set(BOT_NICKNAMES.map((name) => name.toLowerCase())).size).toBe(BOT_NICKNAMES.length);
  });
});
