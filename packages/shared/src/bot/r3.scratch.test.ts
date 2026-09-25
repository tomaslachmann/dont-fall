import { it } from "vitest";
import type { BotLevel } from "../match/LobbyBots.js";
import { SLIP_STREAM_TRACK } from "../track/slipStream.js";
import { SPIN_CYCLE_TRACK } from "../track/spinCycle.js";
import { TICK_DT } from "../tuning/clock.js";
import { loadTestLibrary, obstacleFalls, playSection } from "./sectionHarness.js";
import { SweeperHold } from "./sweeperHold.js";

/** Scratch (M17 07i round 3): legs × levels × seeds, one line each. Deleted at the end of the round. */
const TRACKS = {
  spin0: { track: SPIN_CYCLE_TRACK, leg: 0 },
  spin1: { track: SPIN_CYCLE_TRACK, leg: 1 },
  slip2: { track: SLIP_STREAM_TRACK, leg: 2 },
} as const;

const legs = (process.env.R3_LEGS ?? "slip2").split(",") as (keyof typeof TRACKS)[];
const levels = (process.env.R3_LEVELS ?? "hard,normal,easy").split(",") as BotLevel[];
const seeds = (process.env.R3_SEEDS ?? "0").split(",");

for (const name of legs) {
  for (const level of levels) {
    for (const seed of seeds) {
      it(`${name} ${level} seed ${seed}`, async () => {
        await loadTestLibrary();
        const { track, leg } = TRACKS[name];
        const gaveUp = SweeperHold.gaveUp;
        const arcs = SweeperHold.arcs;
        const dropped = SweeperHold.arcsDropped;
        const out = await playSection({ track, leg, level, seed: `holds:${name}:${level}:${seed}`, capSeconds: 120 });
        const mean = out.passTicks.length === 0 ? NaN : (out.passTicks.reduce((a, b) => a + b, 0) / out.passTicks.length) * TICK_DT;
        console.log(
          `[r3] ${name} ${level} s${seed}: passed ${out.passed}, stranded ${out.stranded}, slow ${out.slow}, obstacle Falls ${obstacleFalls(out.falls)} ${JSON.stringify(out.falls)}, mean pass ${mean.toFixed(1)} s, gave up ${SweeperHold.gaveUp - gaveUp}, arcs ${SweeperHold.arcs - arcs} (dropped ${SweeperHold.arcsDropped - dropped}), think ${out.thinkUsPerBotTick.toFixed(1)} µs`,
        );
        if (process.env.R3_WHERE) for (const line of out.where) console.log(`  ${line}`);
      }, 600_000);
    }
  }
}
