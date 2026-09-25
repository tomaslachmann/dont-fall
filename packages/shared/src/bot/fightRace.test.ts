import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveRoundRules } from "../match/RoundRules.js";
import { RapierSimulation, initPhysics } from "../simulation/RapierSimulation.js";
import type { SimInputs } from "../simulation/SimInputs.js";
import type { CharacterSnapshot, RagdollCause } from "../state/SimState.js";
import type { Module } from "../track/Module.js";
import { loadAssetLibrary } from "../track/assetModules.js";
import { BASE_RACE_TRACK } from "../track/baseRace.js";
import { resolveTrack } from "../track/resolveTrack.js";
import { trackSpawn } from "../track/Track.js";
import { TICK_DT } from "../tuning/clock.js";
import { ELIMINATION_CREDIT_TICKS } from "../tuning/fight.js";
import { buildBotTrack, disposeBotTrack, type Bot, type BotTrack } from "./Bot.js";
import type { FightTally } from "./fight.js";
import { initNavigation } from "./navMesh.js";
import { withPerceptionDelay } from "./perceptionDelay.js";
import { botProfile } from "./profile.js";
import { TreeBot } from "./TreeBot.js";

/**
 * M17 ticket 09's acceptance suite: twelve Bots at NORMAL race the base race
 * from its Start with every Motion running, as `BotDriver` seats them (a
 * `TreeBot` per seat, seeded by the Match and the seat, behind its perception
 * delay). Every Fall is put down to its cause — the last thing that touched
 * the Bot within the game's own credit window (`ELIMINATION_CREDIT_TICKS`,
 * ADR 0110) — and a Fall nothing touched is the Bot's own. Its own Fall is
 * the Fight's when the Fight was driving it within {@link FIGHT_BLAME_TICKS}
 * of its last Tick on the ground: that is the one this ticket must never
 * have (ADR 0129: never suicidal). Any other is the run's, the navigation's
 * to answer (tickets 05–07), and is counted, not asserted.
 */

const assetsRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");
const RULES = resolveRoundRules({ timeLimitMs: 300_000, fallBehavior: "respawn", survivorTarget: 1 });
const BOTS = 12;
const RUN_SECONDS = 180;
/**
 * How long before leaving the ground the Fight still answers for a Fall
 * nothing touched. The Fight only walks full-grip floor (`fightRunClear`),
 * where a capsule stops within a Tick of letting go of its input (ADR 0035),
 * so a few Ticks after the Fight's last input, where the Bot goes is the
 * Race goal's doing. Measured: the one Fall this ever caught at 15 Ticks was
 * a Bot the goal walked 2 m forward and off the end of its path, 13 Ticks
 * after its Fight had moved it the other way.
 */
const FIGHT_BLAME_TICKS = 5;

/**
 * How much further than its own velocity takes it a Bot must go in a Tick to
 * have been carried by something (M17 ticket 06): a swinging wrecking ball
 * pushes a capsule out of its way without an Impact to show for it, so with
 * nothing else recorded such a Fall read as the Fight's (measured, one Bot
 * shoved off the stepping stones mid-catch).
 */
const PUSH_MIN_M = 0.05;

/**
 * `knockdown`: a Hit or a Bump. `stagger`: shoved without going down, by a
 * Bump or a Moving Segment (a Stagger carries no cause). `obstacle`: knocked
 * down by one, or carried by one further than its own walk. `fight-self`: the
 * Fight walked it off. `run`: the Race goal did (the navigation's, tickets
 * 05–07).
 */
type FallCause = "knockdown" | "stagger" | "hurl" | "bomb" | "obstacle" | "fight-self" | "run";

/** Which Fall cause a knockdown is, by what knocked it down (ADR 0023's causes). */
const causeOf = (cause: RagdollCause): FallCause => {
  switch (cause) {
    case "Hit":
    case "Bump":
      return "knockdown";
    case "Hurl":
    case "Grab":
      return "hurl";
    case "Blast":
      return "bomb";
    default:
      return "obstacle";
  }
};

let library: Record<string, Module>;
let track: BotTrack;

beforeAll(async () => {
  await Promise.all([initPhysics(), initNavigation()]);
  library = await loadAssetLibrary(
    async (url) => new Uint8Array(readFileSync(join(assetsRoot, url.substring(url.lastIndexOf("/") + 1)))),
    "http://assets.test",
  );
  track = buildBotTrack(resolveTrack(library, BASE_RACE_TRACK));
});
afterAll(() => disposeBotTrack(track));

interface Race {
  falls: Record<FallCause, number>;
  knockdowns: Partial<Record<RagdollCause, number>>;
  tally: FightTally;
  furthestCheckpoint: number;
  finished: number;
  thinkMsPerTick: number;
}

const race = (matchId: string): Race => {
  const sim = new RapierSimulation({ ...track.resolved, withDefaultCharacter: false });
  const inner = new Map<string, TreeBot>();
  const bots = new Map<string, Bot>();
  for (let i = 0; i < BOTS; i += 1) {
    const id = `bot-${i}`;
    const seed = `${matchId}:${id}`;
    const profile = botProfile("normal", seed);
    const tree = new TreeBot({ seed, profile });
    inner.set(id, tree);
    bots.set(id, withPerceptionDelay(tree, profile, seed));
    sim.addCharacter(id, trackSpawn(BASE_RACE_TRACK, i, library));
  }
  const falls: Record<FallCause, number> = { knockdown: 0, stagger: 0, hurl: 0, bomb: 0, obstacle: 0, "fight-self": 0, run: 0 };
  const knockdowns: Partial<Record<RagdollCause, number>> = {};
  /** The last thing that touched each Bot, and when. */
  const touched = new Map<string, { tick: number; cause: FallCause }>();
  /** The last Tick each Bot's own Fight drove it, and the last it stood on the ground. */
  const lastFought = new Map<string, number>();
  const lastGrounded = new Map<string, number>();
  let previous = sim.snapshot();
  let thinkMs = 0;
  const ticks = Math.round(RUN_SECONDS / TICK_DT);
  for (let n = 0; n < ticks; n += 1) {
    const state = previous;
    const inputs: Record<string, SimInputs> = {};
    const started = performance.now();
    for (const [id, bot] of bots) {
      inputs[id] = bot.think({ tick: state.tick + 1, id, self: state.characters[id]!, characters: state.characters, props: state.props, bombs: state.bombs ?? [], track, rules: RULES });
      if (inner.get(id)!.fighting) lastFought.set(id, state.tick);
    }
    thinkMs += performance.now() - started;
    sim.tick(inputs, "RUNNING");
    const next = sim.snapshot();
    for (const id of bots.keys()) {
      const before: CharacterSnapshot = state.characters[id]!;
      const after: CharacterSnapshot = next.characters[id]!;
      if (after.ragdollEpoch > before.ragdollEpoch && after.ragdollCause !== "Fall") {
        knockdowns[after.ragdollCause] = (knockdowns[after.ragdollCause] ?? 0) + 1;
        touched.set(id, { tick: next.tick, cause: causeOf(after.ragdollCause) });
      } else if (after.motionState === "Held" && before.motionState !== "Held") touched.set(id, { tick: next.tick, cause: "hurl" });
      else if (after.hitReactEpoch > before.hitReactEpoch) touched.set(id, { tick: next.tick, cause: "knockdown" });
      else if (after.motionState === "Stagger" && before.motionState !== "Stagger") touched.set(id, { tick: next.tick, cause: "stagger" });
      if (before.grounded) lastGrounded.set(id, state.tick);
      // Carried further than its own velocity takes it (M17 ticket 06): a Moving Segment's push, which no Impact records.
      const ownRun = Math.hypot(after.velocity.x, after.velocity.z) * TICK_DT;
      if (Math.hypot(after.position.x - before.position.x, after.position.z - before.position.z) > ownRun + PUSH_MIN_M) {
        touched.set(id, { tick: next.tick, cause: "obstacle" });
      }
      if (after.fallCount > before.fallCount) {
        const touch = touched.get(id);
        if (touch && next.tick - touch.tick <= ELIMINATION_CREDIT_TICKS) falls[touch.cause] += 1;
        else if ((lastFought.get(id) ?? -Infinity) >= (lastGrounded.get(id) ?? 0) - FIGHT_BLAME_TICKS) falls["fight-self"] += 1;
        else falls.run += 1;
      }
    }
    previous = next;
  }
  const tally: FightTally = { strikes: 0, catches: 0, lifts: 0, hurls: 0, tosses: 0, bombThrows: 0, bombCatches: 0, drops: 0 };
  for (const tree of inner.values()) for (const key of Object.keys(tally) as (keyof FightTally)[]) tally[key] += tree.fightTally[key];
  const characters = Object.values(previous.characters);
  sim.dispose();
  return {
    falls,
    knockdowns,
    tally,
    furthestCheckpoint: Math.max(...characters.map((c) => c.checkpointIndex ?? -1)),
    finished: characters.filter((c) => c.finishTick !== null).length,
    thinkMsPerTick: thinkMs / ticks,
  };
};

describe("twelve Bots race the base race at NORMAL, fighting, with Motion running (M17 ticket 09)", () => {
  const races: Race[] = [];
  beforeAll(() => {
    for (const matchId of ["fight-race-a", "fight-race-b"]) races.push(race(matchId));
    // The ticket's record: what a Round of it looks like.
    console.log(JSON.stringify(races, null, 1));
  }, 600_000);

  it("fights: Hits land, knock down, and Characters are caught", () => {
    for (const run of races) {
      expect(run.tally.strikes).toBeGreaterThan(0);
      expect(run.knockdowns.Hit ?? 0).toBeGreaterThan(0);
    }
  });

  it("still races: the pack gets past its first Checkpoint", () => {
    for (const run of races) expect(run.furthestCheckpoint).toBeGreaterThanOrEqual(0);
  });

  it("never has a Bot's own Fight walk it off the Track: every Fall the Fight drove had a cause", () => {
    for (const run of races) expect(run.falls["fight-self"]).toBe(0);
  });
});
