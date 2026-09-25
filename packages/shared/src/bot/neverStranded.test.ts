import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveRoundRules } from "../match/RoundRules.js";
import { vec3, type Vec3 } from "../math/vec3.js";
import { RapierSimulation, initPhysics } from "../simulation/RapierSimulation.js";
import { IDLE_INPUTS, type SimInputs } from "../simulation/SimInputs.js";
import type { CharacterSnapshot } from "../state/SimState.js";
import { at, onTop } from "../track/authoring.js";
import type { Module } from "../track/Module.js";
import { loadAssetLibrary } from "../track/assetModules.js";
import { resolveTrack } from "../track/resolveTrack.js";
import type { Track } from "../track/Track.js";
import { BOT_HOP_SAFE_RUN_MIN, BOT_ICE_WALL_MARGIN_M, BOT_LEVEL_SPREADS, BOT_STALL_TICKS } from "../tuning/bots.js";
import { CAPSULE_BOTTOM_OFFSET } from "../tuning/character.js";
import { TICK_DT } from "../tuning/clock.js";
import { buildBotTrack, disposeBotTrack, type Bot, type BotTrack } from "./Bot.js";
import { keepOffEdges } from "./edgeGuard.js";
import { HopReader, hopSafeRun, hopStartable } from "./links.js";
import { initNavigation, navFloorWithin } from "./navMesh.js";
import { PathFollower, type Steering } from "./PathBot.js";
import { withPerceptionDelay } from "./perceptionDelay.js";
import { botProfile, type BotProfile } from "./profile.js";
import { TreeBot } from "./TreeBot.js";

/**
 * M17 ticket 06b's pieces, on small Tracks: a link off a bounce deck proven
 * from every phase of the hop and timed by a Bot off its own late view, and
 * the rule that a Bot is never stranded ("never stranded", the user's call on
 * 2026-09-24): wherever a link or a crowd is the only way on, a Bot at any
 * level gets through. The whole rule on the authored Races is
 * `neverStepsOff.test.ts`, which now also counts who finishes.
 */

const assetsRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");
const RULES = resolveRoundRules({ timeLimitMs: 300_000, fallBehavior: "respawn", survivorTarget: 1 });

let library: Record<string, Module>;
const built: BotTrack[] = [];
beforeAll(async () => {
  await Promise.all([initPhysics(), initNavigation()]);
  library = await loadAssetLibrary(
    async (url) => new Uint8Array(readFileSync(join(assetsRoot, url.substring(url.lastIndexOf("/") + 1)))),
    "http://assets.test",
  );
});
afterAll(() => built.forEach(disposeBotTrack));

const botTrackOf = (track: Track): BotTrack => {
  const botTrack = buildBotTrack(resolveTrack(library, track));
  built.push(botTrack);
  return botTrack;
};

const TOP = 4;
/** A lane deck 12 m long, centred `s` metres down the course. */
const lane = (s: number, extra: { bounce?: boolean; ice?: boolean } = {}) => onTop("kaykit_platform_6x6x1_blue", 0, TOP, s, { scale: 2, ...extra });
const finish = (s: number) => at("kaykit_signage_finish_wide", 0, TOP, s, { scale: 1.25 });

/** EASY at its slowest and clumsiest, with no fight in it: the Bot that sees itself latest. */
const worstEasy = (seed: string): BotProfile => {
  const { reactionTicks, clumsiness } = BOT_LEVEL_SPREADS.easy;
  return { ...botProfile("easy", seed), reactionTicks: reactionTicks.max, clumsiness: clumsiness.max, aggression: 0 };
};

/** Runs Bots from `starts` as `BotDriver` seats them (a `TreeBot` behind its perception delay) for `seconds`. */
const race = (track: BotTrack, starts: readonly Vec3[], seconds: number, profileOf = worstEasy): CharacterSnapshot[] => {
  const sim = new RapierSimulation({ ...track.resolved, withDefaultCharacter: false });
  const bots = new Map<string, Bot>();
  starts.forEach((start, i) => {
    const id = `bot-${i}`;
    const seed = `never-stranded:${id}`;
    const profile = profileOf(seed);
    bots.set(id, withPerceptionDelay(new TreeBot({ seed, profile }), profile, seed));
    sim.addCharacter(id, start);
  });
  try {
    for (let n = 0; n < seconds / TICK_DT; n += 1) {
      const state = sim.snapshot();
      if (Object.values(state.characters).every((c) => c.finishTick !== null)) break;
      const inputs: Record<string, SimInputs> = {};
      for (const [id, bot] of bots) {
        if (state.characters[id]!.finishTick !== null) continue;
        inputs[id] = bot.think({ tick: state.tick + 1, id, self: state.characters[id]!, characters: state.characters, props: state.props, track, rules: RULES });
      }
      sim.tick(inputs, "RUNNING");
    }
    return Object.values(sim.snapshot().characters);
  } finally {
    sim.dispose();
  }
};

describe("reading a bounce deck's hop (M17 ticket 06b)", () => {
  it("counts the proof's phases: a link's own cycle, read off a capsule hopping on it, one phase a Tick", () => {
    // Two bounce lanes two metres apart: the link between them starts on a bounce deck.
    const track = botTrackOf([lane(6, { bounce: true }), lane(20, { bounce: true }), finish(22)]);
    const link = track.nav.links.find((l) => l.hop !== undefined);
    expect(link).toBeDefined();
    const { cycle, safe } = link!.hop!;
    expect(cycle.length).toBeGreaterThan(10);
    expect(hopSafeRun(safe)).toBeGreaterThanOrEqual(BOT_HOP_SAFE_RUN_MIN);

    // A capsule put down at the link's start hops; once settled, each Snapshot reads as the next phase.
    const sim = new RapierSimulation({ ...track.resolved, withDefaultCharacter: false });
    sim.addCharacter("c", vec3(link!.from.x, link!.from.y + CAPSULE_BOTTOM_OFFSET + 0.05, link!.from.z));
    const reader = new HopReader();
    const read: (number | null)[] = [];
    try {
      for (let tick = 0; tick < 4 * cycle.length; tick += 1) {
        read.push(reader.read(cycle, sim.snapshot().characters.c!));
        sim.tick({ c: IDLE_INPUTS });
      }
    } finally {
      sim.dispose();
    }
    const settled = read.slice(3 * cycle.length);
    expect(settled.every((phase) => phase !== null)).toBe(true);
    for (let i = 1; i < settled.length; i += 1) expect(settled[i]).toBe((settled[i - 1]! + 1) % cycle.length);
  });

  it("starts a hop only when every phase its lateness allows is a safe one", () => {
    const hop = { cycle: [], safe: [true, true, true, false, false, false, false, true] };
    expect(hopSafeRun(hop.safe)).toBe(4);
    // Seen at 6, two to three Ticks late: really at 0 or 1, both safe.
    expect(hopStartable(hop, 6, 2, 3)).toBe(true);
    // Seen at 1, two to three Ticks late: really at 3 or 4, neither safe.
    expect(hopStartable(hop, 1, 2, 3)).toBe(false);
    expect(hopStartable(hop, null, 0, 0)).toBe(false);
    expect(hopStartable({ cycle: [], safe: [true, true] }, null, 5, 9)).toBe(true);
  });
});

describe("a Bot is never stranded (M17 ticket 06b)", () => {
  it("crosses a bounce field lane to lane at EASY's worst, timing each take-off off its own late view, and never Falls", () => {
    const track = botTrackOf([lane(6), lane(20, { bounce: true }), lane(34, { bounce: true }), lane(48, { bounce: true }), lane(62), finish(64)]);
    expect(track.nav.links.filter((l) => l.hop !== undefined).length).toBeGreaterThan(0);
    const [end] = race(track, [{ x: 0, y: TOP + 1, z: -2 }], 120);
    expect(end!.fallCount).toBe(0);
    expect(end!.finishTick).not.toBeNull();
  });

  it("heads straight apart, with a jump, from a Character it has been pressed into while it got nowhere", () => {
    // Two capsules pressed deep together hold each other whichever way either
    // walks (measured on Slip Stream's start yard, after a Respawn onto
    // someone): a Bot pushing on and seeing itself go nowhere gets out.
    const track = botTrackOf([lane(6), lane(18), finish(20)]);
    const sim = new RapierSimulation({ ...track.resolved, withDefaultCharacter: false });
    sim.addCharacter("c", { x: 0, y: TOP + 1, z: -6 });
    for (let tick = 0; tick < 10; tick += 1) sim.tick({ c: IDLE_INPUTS });
    const self = sim.snapshot().characters.c!;
    sim.dispose();
    const behind = { x: self.position.x, y: self.position.y, z: self.position.z + 0.5 };
    const follower = new PathFollower();
    const route = { target: { x: 0, y: TOP, z: -20 }, via: null, key: "leg" };
    const steered: Steering[] = [];
    for (let tick = 1; tick <= BOT_STALL_TICKS + 3; tick += 1) steered.push(follower.follow({ tick, id: "c", self, characters: {}, track, rules: RULES }, route, [behind]));
    // Pushing for the finish all the while it got nowhere...
    expect(steered[0]!.moveDirection.z).toBeLessThan(0);
    // ...then away from the one behind it, jumping.
    const out = steered.at(-1)!;
    expect(out.moveDirection.z).toBeLessThan(-0.99);
    expect(out.jump).toBe(true);
  });

  it("keeps a path's corners on ice off a still obstacle's side, which on grip it leaves alone", () => {
    // On ice any touch at a slide's speed knocks a Character down (ADR 0102); on grip, brushing past is nothing.
    const moveOf = (ice: boolean): number => {
      const track = botTrackOf([lane(6), lane(18, { ice }), at("kaykit_ball_red", 1.5, TOP, 18), lane(30), finish(32)]);
      // A corner right on the border of the hole the navmesh has round the bumper, on its side toward the lane's middle.
      let hugging: Vec3 | null = null;
      for (let x = 1.5; x > -3 && hugging === null; x -= 0.02) hugging = navFloorWithin(track.nav, { x, y: TOP, z: -18 }, { x: 0.01, y: 0.5, z: 0.01 });
      expect(hugging).not.toBeNull();
      const [moved] = keepOffEdges(track.nav, [{ point: hugging!, link: null }]);
      return Math.hypot(moved!.point.x - hugging!.x, moved!.point.z - hugging!.z);
    };
    expect(moveOf(false)).toBe(0);
    expect(moveOf(true)).toBeGreaterThanOrEqual(BOT_ICE_WALL_MARGIN_M - 1e-3);
  });
});
