import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { BotLevel } from "../match/LobbyBots.js";
import { resolveRoundRules } from "../match/RoundRules.js";
import type { Vec3 } from "../math/vec3.js";
import { RapierSimulation, initPhysics } from "../simulation/RapierSimulation.js";
import type { SimInputs } from "../simulation/SimInputs.js";
import type { CharacterSnapshot, SimState } from "../state/SimState.js";
import { BASE_RACE_TIME_LIMIT_MS, BASE_RACE_TRACK } from "../track/baseRace.js";
import type { Module } from "../track/Module.js";
import { loadAssetLibrary } from "../track/assetModules.js";
import { resolveTrack } from "../track/resolveTrack.js";
import { SLIP_STREAM_TIME_LIMIT_MS, SLIP_STREAM_TRACK } from "../track/slipStream.js";
import { SPIN_CYCLE_TIME_LIMIT_MS, SPIN_CYCLE_TRACK } from "../track/spinCycle.js";
import type { ConveyorBelt } from "../track/Conveyor.js";
import { trackSpawn, type Track } from "../track/Track.js";
import { atRest } from "../track/walkTrack.js";
import { BOT_LEVEL_SPREADS } from "../tuning/bots.js";
import { CAPSULE_BOTTOM_OFFSET, CAPSULE_RADIUS } from "../tuning/character.js";
import { TICK_DT } from "../tuning/clock.js";
import { ELIMINATION_CREDIT_TICKS } from "../tuning/fight.js";
import { buildBotTrack, disposeBotTrack, type Bot } from "./Bot.js";
import { LinkReplay } from "./links.js";
import { initNavigation } from "./navMesh.js";
import { withPerceptionDelay } from "./perceptionDelay.js";
import { botProfile, type BotProfile } from "./profile.js";
import { TreeBot } from "./TreeBot.js";

/**
 * M17 ticket 06's suite, ADR 0129's "chaotic, never suicidal": a Bot never
 * steps off the Track of its own accord, at any difficulty.
 *
 * Every authored Race (the Tracks with a finish: an arena's rule belongs with
 * Survival, ticket 12), twelve Bots, every Motion stopped and no Hit or Grab
 * (aggression 0), at EASY with its reactions and clumsiness at their worst,
 * at NORMAL and at HARD: **no Fall of a Bot's own**. With nothing moving and
 * nobody fighting, only a Bot's own feet, or another Bot's, can take it off.
 *
 * Every Fall is put down to a cause, so a failure says what to fix, asked in
 * this order:
 * - what touched the Bot: a knockdown (its `RagdollCause`; a crash on ice
 *   into someone is their `Bump`), a Stagger (`Bump` with someone at hand),
 *   within the game's own credit window (`ELIMINATION_CREDIT_TICKS`) or
 *   never got up from;
 * - `link`: the link it was on, a jump taken badly;
 * - `belt`: a belt it stood on carried it (ticket 07's: a belt is a cost or
 *   a gift along its direction);
 * - `contact`: another Character pressed against it;
 * - `pushed`: something carried it further than its own walk (with Motion
 *   running, a Moving Segment: ticket 07's);
 * - `step-off`: none of these. The Bot walked off on its own: the bug.
 * Another Character's Bump or contact is a shove (ADR 0129: a cause the game
 * can name), with no Fight in the Round a pack of Bots crowding, left open in
 * the ticket; belts and pushes are ticket 07's. Every other cause counts.
 *
 * At rest every Bot also finishes (M17 ticket 06b, "never stranded": a
 * link, a bounce deck or a crowd is never where a Bot stops for good), but
 * for the belt-bound Rounds in {@link MAY_NOT_FINISH}.
 *
 * The same Tracks with their Motion running are run once more, shorter, where
 * moving obstacles may knock a Bot off (ticket 07's to answer, logged by
 * cause: a knockdown, a push, a jump a moving piece got in the way of) but a
 * `step-off` still may not happen.
 */

const assetsRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");
const RULES = resolveRoundRules({ timeLimitMs: 300_000, fallBehavior: "respawn", survivorTarget: 1 });
const BOTS = 12;
/** A link that drove a Bot this close before it last stood answers for its Fall. */
const LINK_BLAME_TICKS = 5;
/** How near another Character must be for a Stagger to count as its Bump: two capsules touching, with room. */
const BUMP_REACH_M = 1.2;
/**
 * Another Character touching the Bot this close before it last stood in its
 * own control answers for a Fall nothing else touched (`contact`): two
 * capsules pressed together shove each other about without a Stagger to show
 * for it (measured on the base race's stepping stones).
 */
const CONTACT_BLAME_TICKS = 10;
/**
 * A Tick the Bot went further than its own velocity takes it by this much
 * was something else carrying it (`pushed`): a Moving Segment shoving it or
 * giving it a Ride (ADR 0061), a Prop rolling into it. Within
 * {@link PUSH_BLAME_TICKS} of its last stand in its own control, that is
 * the Fall's cause: with Motion running, ticket 07's to answer.
 */
const PUSH_MIN_M = 0.05;
const PUSH_BLAME_TICKS = 30;
/**
 * A belt the Bot stood on this close before it last stood answers for its
 * Fall, and this far past the belt's deck still counts as on it: a belt
 * running across the lane carries a Bot onto its deck's bevel, where it
 * clings for a while before it goes.
 */
const BELT_BLAME_TICKS = 90;
const BELT_REACH_M = CAPSULE_RADIUS + 0.2;

/**
 * Whether `position` stands on one of the Track's belts. A belt carrying a
 * Bot off is not the Bot's own step: crossing a belt is ticket 07's (a belt
 * is a cost or a gift along its direction), so the suite names it `belt`
 * and leaves it out of the count.
 */
const onBelt = (belts: readonly ConveyorBelt[], position: Vec3): boolean =>
  belts.some(({ deck: { center, yaw, halfX, halfZ } }) => {
    if (Math.abs(position.y - CAPSULE_BOTTOM_OFFSET - center.y) > 1.5) return false;
    const dx = position.x - center.x;
    const dz = position.z - center.z;
    const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    return Math.abs(lx) <= halfX + BELT_REACH_M && Math.abs(lz) <= halfZ + BELT_REACH_M;
  });

interface Course {
  name: string;
  track: Track;
  /** The Round's clock: a Bot still running when it runs out has not Fallen, it is only slow. */
  seconds: number;
}

/** How long a Round with Motion running is played: past every Bot's first moving obstacles, which is all it is here to see. */
const MOVING_SECONDS = 120;
/** How many Ticks a Round plays between letting the test runner speak. */
const YIELD_TICKS = 600;

const COURSES: Course[] = [
  { name: "base race", track: BASE_RACE_TRACK, seconds: BASE_RACE_TIME_LIMIT_MS / 1000 },
  { name: "Spin Cycle", track: SPIN_CYCLE_TRACK, seconds: SPIN_CYCLE_TIME_LIMIT_MS / 1000 },
  { name: "Slip Stream", track: SLIP_STREAM_TRACK, seconds: SLIP_STREAM_TIME_LIMIT_MS / 1000 },
];

const LEVELS: BotLevel[] = ["easy", "normal", "hard"];

/**
 * The profile a seat draws, with no fight in it; at EASY its reactions and
 * clumsiness at their worst (the user's ask, 2026-09-24: hold the rule with
 * clumsiness at its maximum). Read off the table, never copied.
 */
const suiteProfile = (level: BotLevel, seed: string): BotProfile => {
  const drawn = botProfile(level, seed);
  const spread = BOT_LEVEL_SPREADS[level];
  const worst = level === "easy" ? { reactionTicks: spread.reactionTicks.max, clumsiness: spread.clumsiness.max } : {};
  return { ...drawn, ...worst, aggression: 0 };
};

let library: Record<string, Module>;

beforeAll(async () => {
  await Promise.all([initPhysics(), initNavigation()]);
  library = await loadAssetLibrary(
    async (url) => new Uint8Array(readFileSync(join(assetsRoot, url.substring(url.lastIndexOf("/") + 1)))),
    "http://assets.test",
  );
});

/** Why a Bot Fell: what touched it (a `RagdollCause`, `Stagger`, `Held`), `link`, or `step-off`. */
type Tally = Record<string, number>;

interface Round {
  falls: Tally;
  /** Where each Fall left the ground from, for a failure's message. */
  where: string[];
  finished: number;
  /** How many Bots reached each Checkpoint count (`checkpointIndex + 1`), the finish counted as one more. */
  reached: Record<number, number>;
  thinkUsPerBotTick: number;
}

/**
 * One Round of `course` with twelve Bots at `level`, as `BotDriver` seats
 * them (a `TreeBot` per seat behind its perception delay), every Fall put
 * down to its cause.
 */
const playRound = async (course: Course, level: BotLevel, motion: boolean): Promise<Round> => {
  const track = motion ? course.track : atRest(course.track);
  // A Round's own, as a Match builds one: the forks its first Bot finds are this Round's (links are proven once per process anyway).
  const botTrack = buildBotTrack(resolveTrack(library, track));
  const sim = new RapierSimulation({ ...botTrack.resolved, withDefaultCharacter: false });
  const bots = new Map<string, Bot>();
  for (let i = 0; i < BOTS; i += 1) {
    const id = `bot-${i}`;
    const seed = `never-steps-off:${course.name}:${level}:${id}`;
    const profile = suiteProfile(level, seed);
    bots.set(id, withPerceptionDelay(new TreeBot({ seed, profile }), profile, seed));
    sim.addCharacter(id, trackSpawn(track, i, library));
  }
  const steps = vi.spyOn(LinkReplay.prototype, "step");
  const falls: Tally = {};
  const where: string[] = [];
  const touched = new Map<string, { tick: number; cause: string }>();
  const lastLink = new Map<string, number>();
  const lastGround = new Map<string, { tick: number; position: Vec3 }>();
  const lastBelt = new Map<string, number>();
  const lastContact = new Map<string, number>();
  const lastPushed = new Map<string, number>();
  let state: SimState = sim.snapshot();
  let thinkMs = 0;
  let thinks = 0;
  const ticks = Math.round((motion ? Math.min(course.seconds, MOVING_SECONDS) : course.seconds) / TICK_DT);
  try {
    for (let n = 0; n < ticks; n += 1) {
      // Let the test runner's own messages through now and then: a Round is minutes of Ticks.
      if (n % YIELD_TICKS === 0) await new Promise((resolve) => setImmediate(resolve));
      const inputs: Record<string, SimInputs> = {};
      let running = 0;
      for (const [id, bot] of bots) {
        const self = state.characters[id]!;
        if (self.finishTick !== null) continue;
        running += 1;
        const calls = steps.mock.calls.length;
        const started = performance.now();
        inputs[id] = bot.think({ tick: state.tick + 1, id, self, characters: state.characters, props: state.props, bombs: state.bombs ?? [], track: botTrack, rules: RULES });
        thinkMs += performance.now() - started;
        thinks += 1;
        if (steps.mock.calls.length > calls) lastLink.set(id, state.tick);
      }
      if (running === 0) break;
      sim.tick(inputs, "RUNNING");
      const next = sim.snapshot();
      for (const id of bots.keys()) {
        const before: CharacterSnapshot = state.characters[id]!;
        const after: CharacterSnapshot = next.characters[id]!;
        const touching = Object.entries(next.characters).some(
          ([other, c]) => other !== id && !c.eliminated && Math.hypot(c.position.x - after.position.x, c.position.z - after.position.z) < BUMP_REACH_M,
        );
        if (touching) lastContact.set(id, next.tick);
        // Carried further than its own velocity takes it: a Moving Segment's push or its Ride (ADR 0061), or a rolling Prop.
        const ownRun = Math.hypot(after.velocity.x, after.velocity.z) * TICK_DT;
        const run = Math.hypot(after.position.x - before.position.x, after.position.z - before.position.z);
        if (run > ownRun + PUSH_MIN_M) lastPushed.set(id, next.tick);
        // Running into someone on ice knocks the runner down (ADR 0102): two Characters meeting, a Bump by another name.
        if (after.ragdollEpoch > before.ragdollEpoch && after.ragdollCause !== "Fall") {
          touched.set(id, { tick: next.tick, cause: after.ragdollCause === "WallImpact" && touching ? "Bump" : after.ragdollCause });
        }
        else if (after.motionState === "Held" && before.motionState !== "Held") touched.set(id, { tick: next.tick, cause: "Held" });
        else if (after.hitReactEpoch > before.hitReactEpoch) touched.set(id, { tick: next.tick, cause: "Hit" });
        else if (after.motionState === "Stagger" && before.motionState !== "Stagger") {
          // A Stagger carries no cause: another Character within reach is a Bump, anything else was scenery.
          touched.set(id, { tick: next.tick, cause: touching ? "Bump" : "Stagger" });
        }
        if (before.grounded && (before.motionState === "Controlled" || before.motionState === "Sliding")) {
          lastGround.set(id, { tick: state.tick, position: before.position });
        }
        if (onBelt(botTrack.resolved.conveyors, before.position)) lastBelt.set(id, state.tick);
        if (after.fallCount > before.fallCount) {
          const touch = touched.get(id);
          // The last Tick it stood in its own control: a knockdown after it, never got up from, is the Fall's cause however long it lasted.
          const ground = lastGround.get(id);
          let cause: string;
          if (touch !== undefined && (next.tick - touch.tick <= ELIMINATION_CREDIT_TICKS || touch.tick > (ground?.tick ?? -Infinity))) cause = touch.cause;
          else if ((lastLink.get(id) ?? -Infinity) >= (ground?.tick ?? 0) - LINK_BLAME_TICKS) cause = "link";
          else if ((lastBelt.get(id) ?? -Infinity) >= (ground?.tick ?? 0) - BELT_BLAME_TICKS) cause = "belt";
          else if ((lastContact.get(id) ?? -Infinity) >= (ground?.tick ?? 0) - CONTACT_BLAME_TICKS) cause = "contact";
          else if ((lastPushed.get(id) ?? -Infinity) >= (ground?.tick ?? 0) - PUSH_BLAME_TICKS) cause = "pushed";
          else cause = "step-off";
          falls[cause] = (falls[cause] ?? 0) + 1;
          const at = ground?.position ?? before.position;
          where.push(`${id} ${cause} at (${at.x.toFixed(1)}, ${at.y.toFixed(1)}, ${at.z.toFixed(1)}) tick ${ground?.tick}`);
        }
      }
      state = next;
    }
  } finally {
    steps.mockRestore();
  }
  const characters = Object.values(state.characters);
  const finished = characters.filter((c) => c.finishTick !== null).length;
  const reached: Record<number, number> = {};
  for (const c of characters) {
    const count = c.finishTick !== null ? botTrack.resolved.checkpoints.length + 1 : (c.checkpointIndex ?? -1) + 1;
    reached[count] = (reached[count] ?? 0) + 1;
  }
  sim.dispose();
  disposeBotTrack(botTrack);
  return { falls, where, finished, reached, thinkUsPerBotTick: (thinkMs * 1000) / Math.max(1, thinks) };
};

/**
 * Falls with a cause that is not the Bot's own step: another Character's
 * Bump or its contact (a shove, ADR 0129's "a cause the game can name"; with
 * no Fight in the Round it is a pack of Bots crowding, left open in the
 * ticket), a belt carrying it, or something else carrying it (both ticket
 * 07's).
 */
const NOT_ITS_OWN = new Set(["Bump", "contact", "belt", "pushed"]);

/**
 * The Rounds at rest where a Bot may still not finish (M17 ticket 06b's
 * "never stranded" holds everywhere else: every Bot finishes, at every
 * level). Both are belts, ticket 07's: Slip Stream's cross belts carry an
 * EASY Bot over the side again and again, and its third fork's belt arm runs
 * a Bot into the barrier standing on it, where it gets up inside the barrier.
 */
const MAY_NOT_FINISH = new Set(["Slip Stream easy", "Slip Stream normal"]);

/** The Falls that are a Bot's own: everything but {@link NOT_ITS_OWN}. */
const ownFalls = (tally: Tally): number => Object.entries(tally).reduce((sum, [cause, n]) => sum + (NOT_ITS_OWN.has(cause) ? 0 : n), 0);

describe("a Bot never steps off on its own (M17 ticket 06, ADR 0129)", () => {
  describe("every Motion stopped, no fight: no Fall of a Bot's own, and every Bot finishes, at every level", () => {
    for (const course of COURSES) {
      for (const level of LEVELS) {
        it(`${course.name} at ${level.toUpperCase()}`, async () => {
          const round = await playRound(course, level, false);
          console.log(`[at rest] ${course.name} ${level}: ${JSON.stringify({ ...round, where: undefined })}\n  ${round.where.join("\n  ")}`);
          expect(ownFalls(round.falls), round.where.join("\n")).toBe(0);
          // Never stranded (M17 ticket 06b): with nothing moving, every Bot gets to the finish.
          if (!MAY_NOT_FINISH.has(`${course.name} ${level}`)) expect(round.finished).toBe(BOTS);
        }, 600_000);
      }
    }
  });

  describe("Motion running: moving obstacles may knock a Bot off (ticket 07), it never walks off on its own", () => {
    for (const course of COURSES) {
      for (const level of LEVELS) {
        it(`${course.name} at ${level.toUpperCase()}`, async () => {
          const round = await playRound(course, level, true);
          console.log(`[moving] ${course.name} ${level}: ${JSON.stringify({ ...round, where: undefined })}\n  ${round.where.join("\n  ")}`);
          expect(round.falls["step-off"] ?? 0, round.where.join("\n")).toBe(0);
        }, 600_000);
      }
    }
  });
});
