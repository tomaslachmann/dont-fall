import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { facingFromModelYaw, modelYawFromFacing } from "../input/bodyFacing.js";
import { resolveRoundRules } from "../match/RoundRules.js";
import { wrapAngle } from "../math/angle.js";
import type { Vec3 } from "../math/vec3.js";
import { isDownMotionState } from "../simulation/CharacterStateMachine.js";
import { RapierSimulation, initPhysics } from "../simulation/RapierSimulation.js";
import type { SimInputs } from "../simulation/SimInputs.js";
import type { CharacterSnapshot } from "../state/SimState.js";
import { at, onTop, type Extra } from "../track/authoring.js";
import type { Module } from "../track/Module.js";
import { loadAssetLibrary } from "../track/assetModules.js";
import { BASE_RACE_TRACK } from "../track/baseRace.js";
import { resolveTrack } from "../track/resolveTrack.js";
import { trackSpawn, type Track } from "../track/Track.js";
import { atRest } from "../track/walkTrack.js";
import { BOT_DASH_MARGIN_M, BOT_LEG_JOINED_M, BOT_OFF_CORRIDOR_M } from "../tuning/bots.js";
import { FACING_TURN_SPEED_MAX } from "../tuning/character.js";
import { TICK_DT } from "../tuning/clock.js";
import { IMPACT_RAGDOLL_MIN } from "../tuning/knockdown.js";
import { buildBotTrack, disposeBotTrack, type BotTrack, type BotWorldView } from "./Bot.js";
import { forkArms } from "./forks.js";
import { initNavigation, navPath } from "./navMesh.js";
import { dashReach, PathFollower } from "./PathBot.js";
import { TreeBot } from "./TreeBot.js";

const assetsRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");
const RULES = resolveRoundRules({ timeLimitMs: 300_000, fallBehavior: "respawn", survivorTarget: 1 });
const STILL_BASE_RACE = atRest(BASE_RACE_TRACK);

let library: Record<string, Module>;
let baseRace: BotTrack;

/** A follower's view of one Tick (M17 ticket 07: `PathFollower.follow` takes the view): this Bot alone on `track`. */
const followView = (tick: number, self: CharacterSnapshot, track: BotTrack): BotWorldView => ({ tick, id: "self", self, characters: {}, track, rules: RULES });
const tracks: BotTrack[] = [];
beforeAll(async () => {
  await Promise.all([initPhysics(), initNavigation()]);
  library = await loadAssetLibrary(
    async (url) => new Uint8Array(readFileSync(join(assetsRoot, url.substring(url.lastIndexOf("/") + 1)))),
    "http://assets.test",
  );
  baseRace = botTrackOf(STILL_BASE_RACE);
});
afterAll(() => tracks.forEach(disposeBotTrack));
afterEach(() => vi.restoreAllMocks());

const botTrackOf = (track: Track): BotTrack => {
  const built = buildBotTrack(resolveTrack(library, track));
  tracks.push(built);
  return built;
};

const groundDistance = (a: Vec3, b: Vec3): number => Math.hypot(b.x - a.x, b.z - a.z);

interface Drive {
  /** The Checkpoint the Bot is taken to have reached already: the legs before it are ticket 05's to join. */
  credit?: number;
  seconds: number;
  /** Stop once this holds. */
  until?: (self: CharacterSnapshot) => boolean;
  /** Called before each Tick, with the input the Bot chose for it. */
  onTick?: (self: CharacterSnapshot, input: SimInputs, n: number) => void;
}

/**
 * Runs `bot` as the Match loop does: it reads the state after the last Tick
 * and its input drives the next. `credit` stands in for the legs the navmesh
 * does not join yet (ticket 05): the Bot is told it has reached that
 * Checkpoint, and every Checkpoint after it the simulation must see it take.
 */
const drive = (sim: RapierSimulation, track: BotTrack, bot: TreeBot, { credit = -1, seconds, until, onTick }: Drive): CharacterSnapshot => {
  for (let n = 0; n < seconds / TICK_DT; n += 1) {
    const state = sim.snapshot();
    const real = state.characters.bot!;
    const reached = Math.max(real.checkpointIndex ?? -1, credit);
    const self = { ...real, checkpointIndex: reached < 0 ? null : reached };
    if (until?.(self)) break;
    const view: BotWorldView = { tick: state.tick + 1, id: "bot", self, characters: { ...state.characters, bot: self }, track, rules: RULES };
    const input = bot.think(view);
    onTick?.(self, input, n);
    sim.tick({ bot: input }, "RUNNING");
  }
  return sim.snapshot().characters.bot!;
};

const simOf = (track: BotTrack, at: Vec3): RapierSimulation => {
  const sim = new RapierSimulation({ ...track.resolved, withDefaultCharacter: false });
  sim.addCharacter("bot", at);
  return sim;
};

/** Moves the Bot's Character somewhere else at once, as a shove would, keeping everything else about it. */
const teleport = (sim: RapierSimulation, to: Vec3): void => {
  const self = sim.snapshot().characters.bot!;
  sim.reconcileCharacter("bot", { ...self, position: to });
};

/** Where a leg of a Race starts: the Start for the first, the Checkpoint before it after that. */
const legStart = (track: BotTrack, still: Track, leg: number): Vec3 =>
  leg === 0 ? trackSpawn(still, 0, library) : track.resolved.checkpoints[leg - 1]!.respawn;

/** The legs the navmesh joins end to end, by the Checkpoint each runs to (the Checkpoint count for the finish). */
const joinedLegs = (track: BotTrack, still: Track): number[] => {
  const ends = [...track.targets.checkpoints, ...track.targets.finishes.slice(0, 1)];
  return ends.flatMap((end, leg) => {
    const last = navPath(track.nav, legStart(track, still, leg), end)?.at(-1);
    return last !== undefined && groundDistance(last, end) <= BOT_LEG_JOINED_M ? [leg] : [];
  });
};

describe("a Bot runs a Race (M17 ticket 04)", () => {
  it("runs every leg of the base race the navmesh joins, taking its Checkpoints in order, without a Fall", () => {
    const legs = joinedLegs(baseRace, STILL_BASE_RACE);
    // Some legs are across gaps at rest: ticket 05's links join them, and with them the whole Race.
    expect(legs.length).toBeGreaterThan(0);
    // Runs of consecutive joined legs, each driven from where its first leg starts.
    const runs: number[][] = [];
    for (const leg of legs) {
      const last = runs[runs.length - 1];
      if (last !== undefined && last[last.length - 1] === leg - 1) last.push(leg);
      else runs.push([leg]);
    }
    const finishLeg = baseRace.resolved.checkpoints.length;
    for (const run of runs) {
      const first = run[0]!;
      const sim = simOf(baseRace, legStart(baseRace, STILL_BASE_RACE, first));
      const reached: number[] = [];
      const end = drive(sim, baseRace, new TreeBot({ seed: "runner" }), {
        credit: first - 1,
        seconds: 60 * run.length,
        onTick: (self) => {
          const at = self.finishTick !== null ? finishLeg : (self.checkpointIndex ?? -1);
          if (at !== (reached.at(-1) ?? first - 1)) reached.push(at);
        },
        until: (self) => self.finishTick !== null || (self.checkpointIndex ?? -1) >= run[run.length - 1]!,
      });
      sim.dispose();
      if (end.finishTick !== null && reached.at(-1) !== finishLeg) reached.push(finishLeg);
      else if (end.finishTick === null && reached.at(-1) !== end.checkpointIndex) reached.push(end.checkpointIndex!);
      // Every leg of the run, one after the other.
      expect(reached).toEqual(run);
      expect(end.fallCount).toBe(0);
    }
  });

  // "From the Start, runs until the navmesh runs out and stands there" was
  // ticket 04's stand-in for the whole Race: with ticket 05's links the navmesh
  // no longer runs out, and `links.test.ts` finishes the base race instead.

  it("waits while it is down, then gets up and carries on to the Checkpoint", () => {
    const sim = simOf(baseRace, baseRace.resolved.checkpoints[0]!.respawn);
    const bot = new TreeBot({ seed: "runner" });
    drive(sim, baseRace, bot, { credit: 0, seconds: 3 });
    sim.applyImpact("bot", { x: 0, y: 0, z: IMPACT_RAGDOLL_MIN * 1.5 }, "Obstacle");
    let wentDown = false;
    const whileDown: SimInputs[] = [];
    const end = drive(sim, baseRace, bot, {
      credit: 0,
      seconds: 40,
      onTick: (self, input) => {
        if (!isDownMotionState(self.motionState)) return;
        wentDown = true;
        whileDown.push(input);
      },
      until: (self) => (self.checkpointIndex ?? -1) >= 1,
    });
    sim.dispose();
    expect(wentDown).toBe(true);
    expect(whileDown.every((input) => input.moveDirection.x === 0 && input.moveDirection.z === 0 && !input.dashHeld)).toBe(true);
    expect(end.checkpointIndex).toBe(1);
    expect(end.fallCount).toBe(0);
  });

  it("after a Fall, runs the leg again from its respawn", () => {
    const respawn = baseRace.resolved.checkpoints[0]!.respawn;
    const sim = simOf(baseRace, respawn);
    const bot = new TreeBot({ seed: "runner" });
    const before = drive(sim, baseRace, bot, { credit: 0, seconds: 3 });
    // Put over the side, well clear of the lane.
    teleport(sim, { x: before.position.x + 20, y: before.position.y, z: before.position.z });
    let respawned: CharacterSnapshot | null = null;
    const end = drive(sim, baseRace, bot, {
      credit: 0,
      seconds: 60,
      onTick: (self) => {
        if (respawned === null && self.respawnCount > 0) respawned = self;
      },
      until: (self) => (self.checkpointIndex ?? -1) >= 1,
    });
    sim.dispose();
    expect(end.fallCount).toBe(1);
    expect(groundDistance(respawned!.position, respawn)).toBeLessThan(1);
    expect(end.checkpointIndex).toBe(1);
  });

  it("plans again at once when pushed off its corridor, and not for a nudge", () => {
    const from = baseRace.resolved.checkpoints[0]!.respawn;
    const target = baseRace.targets.checkpoints[1]!;
    const route = { target, via: null, key: "leg" };
    const sim = simOf(baseRace, from);
    for (let n = 0; n < 10; n += 1) sim.tick({}, "RUNNING");
    const self = sim.snapshot().characters.bot!;
    sim.dispose();
    const plan = navPath(baseRace.nav, self.position, target)!;
    // Somewhere along the first stretch, then off to one side of it.
    const along = (t: number): Vec3 => ({
      x: plan[0]!.x + (plan[1]!.x - plan[0]!.x) * t,
      y: self.position.y,
      z: plan[0]!.z + (plan[1]!.z - plan[0]!.z) * t,
    });
    const onStretch = along(0.5);
    const sideways = (metres: number): Vec3 => {
      const dx = plan[1]!.x - plan[0]!.x;
      const dz = plan[1]!.z - plan[0]!.z;
      const length = Math.hypot(dx, dz);
      return { x: onStretch.x - (dz / length) * metres, y: onStretch.y, z: onStretch.z + (dx / length) * metres };
    };
    const heading = (at: Vec3, corner: Vec3): Vec3 => {
      const length = groundDistance(at, corner);
      return { x: (corner.x - at.x) / length, y: 0, z: (corner.z - at.z) / length };
    };

    const pushed = sideways(BOT_OFF_CORRIDOR_M * 2);
    const follower = new PathFollower();
    follower.follow(followView(0, self, baseRace), route);
    follower.follow(followView(1, { ...self, position: onStretch }, baseRace), route);
    const afterPush = follower.follow(followView(2, { ...self, position: pushed }, baseRace), route);
    const replanned = navPath(baseRace.nav, pushed, target)!;
    const firstCorner = replanned.find((corner) => groundDistance(corner, pushed) > 0.3)!;
    expect(afterPush.moveDirection.x).toBeCloseTo(heading(pushed, firstCorner).x, 5);
    expect(afterPush.moveDirection.z).toBeCloseTo(heading(pushed, firstCorner).z, 5);

    const nudged = sideways(BOT_OFF_CORRIDOR_M / 2);
    const steady = new PathFollower();
    steady.follow(followView(0, self, baseRace), route);
    steady.follow(followView(1, { ...self, position: onStretch }, baseRace), route);
    const afterNudge = steady.follow(followView(2, { ...self, position: nudged }, baseRace), route);
    // Still steering for the corner it had.
    expect(afterNudge.moveDirection.x).toBeCloseTo(heading(nudged, plan[1]!).x, 5);
    expect(afterNudge.moveDirection.z).toBeCloseTo(heading(nudged, plan[1]!).z, 5);
  });

  it("draws nothing from Math.random or the wall clock once built: every Bot is its seed", () => {
    // `mistreevous` names its nodes with Math.random while it builds a tree; that decides nothing.
    const bots = [new TreeBot({ seed: "same" }), new TreeBot({ seed: "same" })];
    const random = vi.spyOn(Math, "random");
    const now = vi.spyOn(Date, "now");
    const getTime = vi.spyOn(Date.prototype, "getTime");
    const runs = bots.map((bot) => {
      const sim = simOf(baseRace, baseRace.resolved.checkpoints[0]!.respawn);
      const inputs: SimInputs[] = [];
      drive(sim, baseRace, bot, { credit: 0, seconds: 5, onTick: (_self, input) => inputs.push(input) });
      sim.dispose();
      return inputs;
    });
    expect(random).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
    expect(getTime).not.toHaveBeenCalled();
    expect(runs[1]).toEqual(runs[0]);
  });

  it("turns its body toward the run as a client does: lagging, never faster than the body turns", () => {
    const sim = simOf(baseRace, baseRace.resolved.checkpoints[0]!.respawn);
    for (let n = 0; n < 10; n += 1) sim.tick({}, "RUNNING");
    const state = sim.snapshot();
    sim.dispose();
    const viewOf = (self: CharacterSnapshot): BotWorldView => ({
      tick: state.tick + 1,
      id: "bot",
      self: { ...self, checkpointIndex: 0 },
      characters: state.characters,
      track: baseRace,
      rules: RULES,
    });
    const first = new TreeBot({ seed: "turn" }).think(viewOf(state.characters.bot!));
    const run = facingFromModelYaw(Math.atan2(first.moveDirection.x, first.moveDirection.z));
    // The same Character, turned to face straight back down the course.
    const turnedAway = { ...state.characters.bot!, facing: facingFromModelYaw(modelYawFromFacing(run) + Math.PI) };

    const bot = new TreeBot({ seed: "turn" });
    let facing = turnedAway.facing;
    const turns: number[] = [];
    for (let n = 0; n < 30; n += 1) {
      const next = bot.think(viewOf(turnedAway)).facing;
      turns.push(Math.abs(wrapAngle(next - facing)));
      facing = next;
    }
    expect(turns[0]).toBeGreaterThan(0);
    expect(Math.max(...turns)).toBeLessThanOrEqual(FACING_TURN_SPEED_MAX * TICK_DT + 1e-9);
    expect(Math.abs(wrapAngle(bot.think(viewOf(turnedAway)).facing - run))).toBeLessThan(0.02);
  });
});

// --- Small Tracks that ask one question each ----------------------------------

const TOP = 4;
const deck = (x: number, s: number, scale: number, extra: Extra = {}) =>
  onTop("kaykit_platform_6x6x1_blue", x, TOP, s, { scale, ...extra });
const FINISH_S = 60;
/**
 * A start deck, a fork of two arms six metres apart with nothing between
 * them, an end deck and a finish gate. `leftArm` is what the left arm is made
 * of.
 */
const forkTrack = (leftArm: Extra = {}): Track => [
  deck(0, 9, 3),
  ...[21, 27, 33, 39, 45].flatMap((s) => [deck(-6, s, 1, leftArm), deck(6, s, 1)]),
  deck(0, 57, 3),
  at("kaykit_signage_finish_wide", 0, TOP, FINISH_S, { scale: 1.25 }),
];
const START = { x: 0, y: TOP + 1, z: -4 };

describe("forks, Surfaces and the Dash (M17 ticket 04)", () => {
  it("spreads a Lobby's Bots across a fork's arms, by each one's seed, and every one finishes", () => {
    const track = botTrackOf(forkTrack());
    expect(forkArms(track.nav, START, track.targets.finishes[0]!)).toHaveLength(2);
    const arms = new Set<string>();
    for (let i = 0; i < 8; i += 1) {
      const sim = simOf(track, START);
      let arm: string | null = null;
      const end = drive(sim, track, new TreeBot({ seed: `bot ${i}` }), {
        seconds: 30,
        onTick: (self) => {
          if (arm === null && -self.position.z > 30) arm = self.position.x < 0 ? "left" : "right";
        },
        until: (self) => self.finishTick !== null,
      });
      sim.dispose();
      expect(end.finishTick).not.toBeNull();
      expect(end.fallCount).toBe(0);
      arms.add(arm!);
    }
    expect(arms).toEqual(new Set(["left", "right"]));
  });

  it("goes round mud when there is a way round: a mud arm is no arm", () => {
    const track = botTrackOf(forkTrack({ mud: true }));
    expect(forkArms(track.nav, START, track.targets.finishes[0]!)).toEqual([]);
    for (let i = 0; i < 4; i += 1) {
      const sim = simOf(track, START);
      let inMud = false;
      const end = drive(sim, track, new TreeBot({ seed: `bot ${i}` }), {
        seconds: 30,
        onTick: (self) => {
          if (-self.position.z > 20 && -self.position.z < 46 && self.position.x < 0) inMud = true;
        },
        until: (self) => self.finishTick !== null,
      });
      sim.dispose();
      expect(end.finishTick).not.toBeNull();
      expect(inMud).toBe(false);
    }
  });

  /** A straight lane that stops at a gap, with the finish out of reach beyond it. */
  const EDGE_S = 84;
  const gapTrack = (): Track => [
    ...[6, 18, 30, 42, 54, 66, 78].map((s) => deck(0, s, 2)),
    deck(0, EDGE_S + 30, 2),
    at("kaykit_signage_finish_wide", 0, TOP, EDGE_S + 30, { scale: 1.25 }),
  ];

  it("spends its Dash on a long straight run, and never carries it into the gap the path stops at", () => {
    const track = botTrackOf(gapTrack());
    const sim = simOf(track, START);
    let dashed = false;
    const end = drive(sim, track, new TreeBot({ seed: "dasher" }), {
      seconds: 25,
      onTick: (self) => (dashed ||= self.dashing),
    });
    sim.dispose();
    expect(dashed).toBe(true);
    expect(end.fallCount).toBe(0);
    expect(-end.position.z).toBeLessThan(EDGE_S);
    expect(-end.position.z).toBeGreaterThan(EDGE_S - 3);
  });

  it("keeps its Dash when the run left before the gap is shorter than a Dash carries", () => {
    const track = botTrackOf(gapTrack());
    const closer = { ...START, z: -(EDGE_S - (dashReach() + BOT_DASH_MARGIN_M) + 2) };
    const sim = simOf(track, closer);
    let pressed = false;
    const end = drive(sim, track, new TreeBot({ seed: "dasher" }), {
      seconds: 15,
      onTick: (_self, input) => (pressed ||= input.dashHeld),
    });
    sim.dispose();
    expect(pressed).toBe(false);
    expect(end.fallCount).toBe(0);
  });

  it("on ice, where its path runs out it pushes against its drift instead of letting go", () => {
    const track = botTrackOf([deck(0, 12, 4, { ice: true })]);
    const sim = simOf(track, { x: 0, y: TOP + 1, z: -12 });
    for (let n = 0; n < 10; n += 1) sim.tick({}, "RUNNING");
    const self = { ...sim.snapshot().characters.bot!, velocity: { x: 0, y: 0, z: -4 } };
    sim.dispose();
    const standHere = { target: self.position, via: null, key: "stand" };
    const steering = new PathFollower().follow(followView(0, self, track), standHere);
    expect(steering.moveDirection.z).toBeCloseTo(1, 5);
    expect(steering.dash).toBe(false);
  });
});
