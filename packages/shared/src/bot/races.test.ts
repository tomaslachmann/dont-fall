import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BotLevel } from "../match/LobbyBots.js";
import { BASE_RACE_TIME_LIMIT_MS, BASE_RACE_TRACK } from "../track/baseRace.js";
import { SLIP_STREAM_TIME_LIMIT_MS, SLIP_STREAM_TRACK } from "../track/slipStream.js";
import { SPIN_CYCLE_TIME_LIMIT_MS, SPIN_CYCLE_TRACK } from "../track/spinCycle.js";
import type { Track } from "../track/Track.js";
import { playRace, type RaceReport } from "./sectionHarness.js";

/*
 * M17 ticket 07d: every Race with Motion running, from the Start, twelve
 * Bots, aggression 0, at every level, against the Track's real Time Limit.
 * A HARD Bot finishes every Race; nobody steps off or is stranded at any
 * level; Falls are counted per section and by cause (`playRace`, the report
 * ticket 11 prints).
 *
 * Heavy (a Round is 5–6 simulated minutes; 20–60 s wall each, nine of
 * them), so it is gated out of the package's default run:
 *
 *     BOT_RACES=1 npx vitest run src/bot/races.test.ts
 *
 * `BOT_RACES_OUT=<file>` also writes every report as JSON.
 */

const RACES: { name: string; track: Track; timeLimitSeconds: number }[] = [
  { name: "base race", track: BASE_RACE_TRACK, timeLimitSeconds: BASE_RACE_TIME_LIMIT_MS / 1000 },
  { name: "Spin Cycle", track: SPIN_CYCLE_TRACK, timeLimitSeconds: SPIN_CYCLE_TIME_LIMIT_MS / 1000 },
  { name: "Slip Stream", track: SLIP_STREAM_TRACK, timeLimitSeconds: SLIP_STREAM_TIME_LIMIT_MS / 1000 },
];
const LEVELS: BotLevel[] = ["hard", "normal", "easy"];

const line = (name: string, r: RaceReport): string =>
  `[07d] ${name} ${r.level}: finished ${r.finished}/${r.bots} stranded ${r.stranded} slow ${r.slow} own ${r.ownFalls} obstacle ${r.obstacleFalls} falls ${JSON.stringify(r.falls)} ` +
  `finish s [${r.finishSeconds.map((s) => s.toFixed(0)).join(",")}] of ${r.timeLimitSeconds} think ${r.thinkUsPerBotTick.toFixed(1)} µs\n` +
  r.sections
    .filter((s) => s.total > 0)
    .map((s) => `    ${s.from} → ${s.to}: ${JSON.stringify(s.falls)}`)
    .join("\n");

describe.skipIf(!process.env.BOT_RACES)("every Race with Motion running (M17 ticket 07d)", () => {
  const reports: Record<string, RaceReport> = {};
  for (const { name, track, timeLimitSeconds } of RACES) {
    for (const level of LEVELS) {
      it(`${name} at ${level}`, async () => {
        const report = await playRace({ track, level, seed: `races:${name}:${level}`, timeLimitSeconds });
        reports[`${name}:${level}`] = report;
        console.log(line(name, report));
        if (process.env.BOT_RACES_OUT) writeFileSync(process.env.BOT_RACES_OUT, JSON.stringify(reports, null, 1));
        expect(report.ownFalls).toBe(0);
        expect(report.stranded).toBe(0);
        if (level === "hard") expect(report.finished).toBeGreaterThanOrEqual(1);
      }, 900_000);
    }
  }
});
