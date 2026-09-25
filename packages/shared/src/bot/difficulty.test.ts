import { describe, expect, it } from "vitest";
import type { BotLevel } from "../match/LobbyBots.js";
import { BASE_RACE_TRACK } from "../track/baseRace.js";
import { TICK_DT } from "../tuning/clock.js";
import { obstacleFalls, playSection } from "./sectionHarness.js";

/**
 * M17 ticket 08's suite, rewritten by ticket 07d: over the base race **with
 * Motion running**, does EASY take longer and Fall more from obstacles than
 * NORMAL, and NORMAL than HARD?
 *
 * One Bot a run (no crowd, so nothing but the Bot's own foresight and
 * timing is measured), Checkpoint 4 to the finish — the belt climb, the
 * sliding walls and hammer alley, the stretch 08 measured — over
 * {@link SEEDS_PER_LEVEL} seeds a level. The order is asserted on the means;
 * the log prints each level's mean, standard deviation and the seeds the
 * measured variance asks for, so the count here can be judged.
 *
 * History: 08 first measured this with reaction time and clumsiness alone
 * (HARD fell more than NORMAL, 3 vs 1 at n = 12), and ticket 06's edge guard
 * then took away the step-offs that had separated the levels. With ticket
 * 07's look-ahead in (a sweeper is timed by `lookAheadTicks` and
 * `timingErrorTicks`), the levels separate on what they foresee.
 */

const LEG = 5;
/** A cap, not a target: a clean run finishes legs 5–7 in about a minute. */
const RUN_SECONDS = 150;
const SEEDS_PER_LEVEL = 16;
const LEVELS: BotLevel[] = ["easy", "normal", "hard"];

interface Run {
  /** Seconds from Checkpoint 4 to the finish, the cap when it never got there. */
  seconds: number;
  obstacleFalls: number;
}

const stats = (xs: number[]): { mean: number; sd: number } => {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, xs.length - 1));
  return { mean, sd };
};

/** Seeds a level needs for a difference of `delta` between two levels to beat two standard errors (pooled `sd`). */
const seedsFor = (sd: number, delta: number): number => (delta <= 0 ? Infinity : Math.ceil(2 * (2 * sd / delta) ** 2));

describe("difficulty separates a Bot's run, Checkpoint 4 to the finish, Motion running (M17 tickets 08 and 07d, ADR 0129)", () => {
  const byLevel: Record<BotLevel, Run[]> = { easy: [], normal: [], hard: [] };
  let ready: Promise<void> | undefined;
  const measure = (): Promise<void> =>
    (ready ??= (async () => {
      for (const level of LEVELS) {
        for (let n = 0; n < SEEDS_PER_LEVEL; n += 1) {
          const outcome = await playSection({ track: BASE_RACE_TRACK, leg: LEG, whole: true, level, seed: `difficulty-suite:${level}:${n}`, bots: 1, capSeconds: RUN_SECONDS });
          byLevel[level].push({ seconds: outcome.passTicks.length > 0 ? outcome.passTicks[0]! * TICK_DT : RUN_SECONDS, obstacleFalls: obstacleFalls(outcome.falls) });
        }
      }
      for (const level of LEVELS) {
        const t = stats(byLevel[level].map((r) => r.seconds));
        const f = stats(byLevel[level].map((r) => r.obstacleFalls));
        console.log(`[difficulty] ${level}: finish ${t.mean.toFixed(1)} s (sd ${t.sd.toFixed(1)}), obstacle Falls ${f.mean.toFixed(2)} (sd ${f.sd.toFixed(2)}), unfinished ${byLevel[level].filter((r) => r.seconds >= RUN_SECONDS).length}/${SEEDS_PER_LEVEL}`);
      }
      const pair = (a: BotLevel, b: BotLevel): string => {
        const ta = stats(byLevel[a].map((r) => r.seconds));
        const tb = stats(byLevel[b].map((r) => r.seconds));
        const fa = stats(byLevel[a].map((r) => r.obstacleFalls));
        const fb = stats(byLevel[b].map((r) => r.obstacleFalls));
        return `${a} > ${b}: time needs n ≥ ${seedsFor((ta.sd + tb.sd) / 2, ta.mean - tb.mean)}, Falls n ≥ ${seedsFor((fa.sd + fb.sd) / 2, fa.mean - fb.mean)}`;
      };
      console.log(`[difficulty] seeds the variance asks for (n = ${SEEDS_PER_LEVEL} a level here): ${pair("easy", "normal")}; ${pair("normal", "hard")}`);
    })());

  it("finishes slower on average: EASY, then NORMAL, then HARD", async () => {
    await measure();
    const mean = (level: BotLevel): number => stats(byLevel[level].map((r) => r.seconds)).mean;
    expect(mean("easy")).toBeGreaterThan(mean("normal"));
    expect(mean("normal")).toBeGreaterThan(mean("hard"));
  }, 600_000);

  it("Falls more often from obstacles at EASY than at NORMAL, and at NORMAL than at HARD", async () => {
    await measure();
    const mean = (level: BotLevel): number => stats(byLevel[level].map((r) => r.obstacleFalls)).mean;
    expect(mean("easy")).toBeGreaterThan(mean("normal"));
    expect(mean("normal")).toBeGreaterThan(mean("hard"));
  }, 600_000);

  it("finishes on almost every seed, at every level: clumsiness slows a Bot, it does not strand it", async () => {
    await measure();
    for (const runs of Object.values(byLevel)) {
      const unfinished = runs.filter((run) => run.seconds >= RUN_SECONDS).length;
      expect(unfinished).toBeLessThanOrEqual(1);
    }
  }, 600_000);
});
