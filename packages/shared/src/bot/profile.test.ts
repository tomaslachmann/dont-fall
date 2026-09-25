import { describe, expect, it } from "vitest";
import { BOT_LEVELS } from "../match/LobbyBots.js";
import { botProfile } from "./profile.js";

const SEEDS = ["match-a:seat-0", "match-a:seat-1", "match-b:seat-0", "another-seed", "🙂"];

describe("a Bot's difficulty spread (M17 ticket 08, ADR 0129)", () => {
  it("draws nothing from Math.random: the same level and seed always draw the same profile", () => {
    for (const seed of SEEDS) {
      const first = botProfile("normal", seed);
      const second = botProfile("normal", seed);
      expect(second).toEqual(first);
    }
  });

  it("draws a different spread for a different seat, most of the time", () => {
    const a = botProfile("normal", "seat-a");
    const b = botProfile("normal", "seat-b");
    expect(a).not.toEqual(b);
  });

  it("every field is what the goal's leaves (tickets 07/09) and the perception delay (this ticket) expect", () => {
    for (const level of BOT_LEVELS) {
      for (const seed of SEEDS) {
        const profile = botProfile(level, seed);
        expect(Number.isInteger(profile.reactionTicks)).toBe(true);
        expect(profile.reactionTicks).toBeGreaterThanOrEqual(0);
        expect(profile.clumsiness).toBeGreaterThanOrEqual(0);
        expect(profile.clumsiness).toBeLessThanOrEqual(1);
        expect(Number.isInteger(profile.lookAheadTicks)).toBe(true);
        expect(profile.lookAheadTicks).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(profile.timingErrorTicks)).toBe(true);
        expect(profile.timingErrorTicks).toBeGreaterThanOrEqual(0);
        expect(profile.aimError).toBeGreaterThanOrEqual(0);
        expect(profile.aggression).toBeGreaterThanOrEqual(0);
        expect(profile.aggression).toBeLessThanOrEqual(1);
        expect(profile.chanceTaking).toBeGreaterThanOrEqual(0);
        expect(profile.chanceTaking).toBeLessThanOrEqual(1);
      }
    }
  });

  it("orders EASY slower and clumsier than NORMAL slower and clumsier than HARD, on any seed", () => {
    // BOT_LEVEL_SPREADS' reactionTicks/clumsiness ranges never overlap between
    // levels (tuning/bots.ts), so this holds for every seed, not just a lucky
    // draw — the ordering ticket 08 asks the suite to prove.
    for (const seed of SEEDS) {
      const easy = botProfile("easy", seed);
      const normal = botProfile("normal", seed);
      const hard = botProfile("hard", seed);
      expect(easy.reactionTicks).toBeGreaterThanOrEqual(normal.reactionTicks);
      expect(normal.reactionTicks).toBeGreaterThanOrEqual(hard.reactionTicks);
      expect(easy.clumsiness).toBeGreaterThan(normal.clumsiness);
      expect(normal.clumsiness).toBeGreaterThan(hard.clumsiness);
    }
  });
});
