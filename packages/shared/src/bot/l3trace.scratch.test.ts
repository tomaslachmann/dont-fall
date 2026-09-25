import { describe, it } from "vitest";
import { resolveRoundRules } from "../match/RoundRules.js";
import { RapierSimulation } from "../simulation/RapierSimulation.js";
import type { SimInputs } from "../simulation/SimInputs.js";
import type { CharacterSnapshot, SimState } from "../state/SimState.js";
import { BASE_RACE_TRACK } from "../track/baseRace.js";
import type { Bot } from "./Bot.js";
import { DeckRider } from "./deckRider.js";
import { withPerceptionDelay } from "./perceptionDelay.js";
import { botProfile, type BotProfile } from "./profile.js";
import { loadTestLibrary, sectionBotTrack } from "./sectionHarness.js";
import { TreeBot } from "./TreeBot.js";
import type { BotLevel } from "../match/LobbyBots.js";

// 07l scratch: trace one Bot Tick by Tick on leg 3. Deleted at the end.
const RULES = resolveRoundRules({ timeLimitMs: 300_000, fallBehavior: "respawn", survivorTarget: 1 });
const LEG = 3;
const LEVEL = (process.env.L3_LEVEL ?? "hard") as BotLevel;
const SEED = process.env.L3_SEED ?? "07l:hard:a";
const WHO = process.env.L3_BOT ?? "bot-1";
const FROM = Number(process.env.L3_FROM ?? 200);
const TO = Number(process.env.L3_TO ?? 360);
const PIVOT = { x: 0, z: -293.5 };

describe("07l trace", () => {
  it("traces", async () => {
    const library = await loadTestLibrary();
    const botTrack = sectionBotTrack(BASE_RACE_TRACK, library);
    const { resolved, moving } = botTrack;
    const sim = new RapierSimulation({ ...resolved, withDefaultCharacter: false, motionClock: 0 });
    const bots = new Map<string, Bot>();
    const respawn = resolved.checkpoints[LEG - 1]!.respawn;
    for (let i = 0; i < 12; i += 1) {
      const id = `bot-${i}`;
      const botSeed = `${SEED}:${id}`;
      const profile: BotProfile = { ...botProfile(LEVEL, botSeed), aggression: 0 };
      bots.set(id, withPerceptionDelay(new TreeBot({ seed: botSeed, profile }), profile, botSeed));
      sim.addCharacter(id, { x: respawn.x + ((i % 4) - 1.5) * 1.1, y: respawn.y, z: respawn.z + (Math.floor(i / 4) - 1) * 1.1 });
    }
    const notes: string[] = [];
    DeckRider.trace = (id, tick, note) => {
      if (id === WHO && tick >= FROM && tick <= TO) notes.push(`  rider ${note}`);
    };
    let state: SimState = sim.snapshot();
    const lines: string[] = [];
    try {
      for (let n = 0; n < TO + 2; n += 1) {
        const inputs: Record<string, SimInputs> = {};
        botTrack.moving.syncFragile(botTrack.nav, state.fragile);
        for (const [id, bot] of bots) {
          const self = state.characters[id]!;
          const seen: CharacterSnapshot = (self.checkpointIndex ?? -1) < LEG - 1 ? { ...self, checkpointIndex: LEG - 1 } : self;
          inputs[id] = bot.think({ tick: state.tick + 1, id, self: seen, characters: state.characters, props: state.props, bombs: state.bombs ?? [], track: botTrack, rules: RULES, runningFromTick: sim.motionClock, fragile: state.fragile });
        }
        const c = state.characters[WHO]!;
        if (state.tick + 1 >= FROM && state.tick + 1 <= TO) {
          const under = moving.platformUnder(c.position, state.tick, sim.motionClock);
          const local = under === null ? null : moving.toLocal(under, state.tick, sim.motionClock, c.position);
          const r = Math.hypot(c.position.x - PIVOT.x, c.position.z - PIVOT.z);
          const inp = inputs[WHO]!;
                    const occ = moving.sweepers.map((b) => (moving.occupies(b.index, state.tick + 1, sim.motionClock, c.position, 0.6) ? b.index : -1)).filter((i) => i >= 0);
          lines.push(
            `t${state.tick + 1} ${c.motionState}${c.grounded ? " G" : " air"} pos (${c.position.x.toFixed(2)},${c.position.y.toFixed(2)},${c.position.z.toFixed(2)}) r ${r.toFixed(2)} under ${under?.index ?? "-"} local ${local === null ? "-" : `(${local.x.toFixed(2)},${local.z.toFixed(2)})`} v (${c.velocity.x.toFixed(1)},${c.velocity.z.toFixed(1)}) in (${inp.moveDirection.x.toFixed(2)},${inp.moveDirection.z.toFixed(2)}) jump ${inp.jumpHeld} occ ${occ.join(",")}`,
          );
          lines.push(...notes.splice(0));
        }
        sim.tick(inputs, "RUNNING");
        state = sim.snapshot();
      }
    } finally {
      DeckRider.trace = null;
      sim.dispose();
    }
    console.log(`\n07l TRACE ${WHO}\n${lines.join("\n")}\n`);
  }, 10 * 60 * 1000);
});
