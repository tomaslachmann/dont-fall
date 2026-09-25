import { describe, it } from "vitest";
import type { BotLevel } from "../match/LobbyBots.js";
import { BASE_RACE_TRACK } from "../track/baseRace.js";
import { obstacleFalls, playSection } from "./sectionHarness.js";

// 07l scratch: base race leg Cp 2 → 3 (the spinning squares), before/after. Deleted at the end.
const LEG = 3;
const CAP = 90;
const LEVELS: BotLevel[] = (process.env.L3_LEVELS?.split(",") as BotLevel[] | undefined) ?? ["hard", "normal", "easy"];
const SEEDS = process.env.L3_SEEDS?.split(",") ?? ["a", "b"];

describe("07l leg 3", () => {
  it("runs", async () => {
    const rows: string[] = [];
    for (const level of LEVELS) {
      for (const s of SEEDS) {
        const o = await playSection({ track: BASE_RACE_TRACK, leg: LEG, level, seed: `07l:${level}:${s}`, capSeconds: CAP });
        const slowest = o.passTicks.length > 0 ? Math.max(...o.passTicks) : -1;
        rows.push(
          `${level} ${s}: passed ${o.passed} stranded ${o.stranded} slow ${o.slow} obstacle ${obstacleFalls(o.falls)} falls ${JSON.stringify(o.falls)} slowest ${slowest} think ${o.thinkUsPerBotTick.toFixed(0)}us`,
        );
        if (process.env.L3_WHERE) rows.push(...o.where.map((w) => `   ${w}`));
      }
    }
    console.log(`\n07l LEG ${LEG}\n${rows.join("\n")}\n`);
  }, 30 * 60 * 1000);
});
