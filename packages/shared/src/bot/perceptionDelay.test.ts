import { describe, expect, it } from "vitest";
import { IDLE_INPUTS } from "../simulation/SimInputs.js";
import { BOT_STUMBLE_EXTRA_TICKS_MAX } from "../tuning/bots.js";
import type { Bot, BotWorldView } from "./Bot.js";
import { withPerceptionDelay } from "./perceptionDelay.js";
import type { BotProfile } from "./profile.js";

const profileOf = (reactionTicks: number, clumsiness: number): BotProfile => ({
  reactionTicks,
  clumsiness,
  lookAheadTicks: 0,
  timingErrorTicks: 0,
  aimError: 0,
  aggression: 0,
  chanceTaking: 0,
});

// A minimal view: `self` carries the Tick it was created at (in a field
// nothing else reads), so a test can tell how stale the `self` an inner Bot
// received was. `view.tick`/`track`/`rules` are never delayed (the wrapper
// only ever forwards the current ones), so they don't need a real shape here.
const viewAt = (tick: number): BotWorldView => ({ tick, self: { respawnCount: tick } }) as unknown as BotWorldView;
const perceivedTickOf = (view: BotWorldView): number => (view.self as unknown as { respawnCount: number }).respawnCount;

const recordingBot = (log: BotWorldView[]): Bot => ({
  think: (view) => {
    log.push(view);
    return IDLE_INPUTS;
  },
});

describe("reaction time is a delay on what a Bot perceives, not on what it outputs (M17 ticket 08)", () => {
  it("with no reaction time and no clumsiness, passes the view through unchanged", () => {
    const log: BotWorldView[] = [];
    const bot = withPerceptionDelay(recordingBot(log), profileOf(0, 0), "seed");
    const view = viewAt(5);
    bot.think(view);
    expect(log[0]).toBe(view);
  });

  it("still returns an input every Tick, and `view.tick` — the Tick it is for — is never delayed", () => {
    const log: BotWorldView[] = [];
    const bot = withPerceptionDelay(recordingBot(log), profileOf(4, 0), "seed");
    for (let tick = 0; tick < 20; tick += 1) expect(bot.think(viewAt(tick))).toBe(IDLE_INPUTS);
    expect(log).toHaveLength(20);
    log.forEach((view, tick) => expect(view.tick).toBe(tick));
  });

  it("delays a steady reaction time by exactly that many Ticks, ramping up until there is that much history", () => {
    const log: BotWorldView[] = [];
    const bot = withPerceptionDelay(recordingBot(log), profileOf(3, 0), "seed");
    for (let tick = 0; tick < 12; tick += 1) bot.think(viewAt(tick));
    for (let n = 0; n < 12; n += 1) expect(perceivedTickOf(log[n]!)).toBe(Math.max(0, n - 3));
  });

  it("widens the delay with clumsiness, never below reactionTicks and never past its stumble max", () => {
    const log: BotWorldView[] = [];
    const reactionTicks = 2;
    const bot = withPerceptionDelay(recordingBot(log), profileOf(reactionTicks, 0.8), "clumsy-seed");
    for (let tick = 0; tick < 80; tick += 1) bot.think(viewAt(tick));
    const delays = log.slice(20).map((view, i) => i + 20 - perceivedTickOf(view));
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(reactionTicks);
    expect(Math.max(...delays)).toBeLessThanOrEqual(reactionTicks + BOT_STUMBLE_EXTRA_TICKS_MAX);
    // A steady reaction time alone would never vary; clumsiness does.
    expect(new Set(delays).size).toBeGreaterThan(1);
  });

  it("draws nothing from Math.random: the delay (steady or stumbled) is the seed's, every run", () => {
    const runOf = (): number[] => {
      const log: BotWorldView[] = [];
      const bot = withPerceptionDelay(recordingBot(log), profileOf(2, 0.6), "same-seed");
      for (let tick = 0; tick < 40; tick += 1) bot.think(viewAt(tick));
      return log.map((view) => perceivedTickOf(view));
    };
    expect(runOf()).toEqual(runOf());
  });
});
