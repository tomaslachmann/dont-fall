import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveRoundRules } from "../match/RoundRules.js";
import type { Vec3 } from "../math/vec3.js";
import { accelerateVelocity } from "../simulation/movementVerbs.js";
import { RapierSimulation, initPhysics } from "../simulation/RapierSimulation.js";
import type { SimInputs } from "../simulation/SimInputs.js";
import type { CharacterSnapshot } from "../state/SimState.js";
import { at, onTop } from "../track/authoring.js";
import type { Module } from "../track/Module.js";
import { loadAssetLibrary } from "../track/assetModules.js";
import { resolveTrack } from "../track/resolveTrack.js";
import type { Track } from "../track/Track.js";
import { BOT_LEVEL_SPREADS, BOT_PATH_EDGE_MARGIN_M } from "../tuning/bots.js";
import { TICK_DT } from "../tuning/clock.js";
import { MOVE_ACCEL_FACTOR, MOVE_FRICTION_FACTOR } from "../tuning/movement.js";
import { buildBotTrack, disposeBotTrack, type Bot, type BotTrack } from "./Bot.js";
import { accelerate, keepOffEdges, navEdgesOf, type Motion } from "./edgeGuard.js";
import { initNavigation, navFloorWithin } from "./navMesh.js";
import { withPerceptionDelay } from "./perceptionDelay.js";
import { botProfile, type BotProfile } from "./profile.js";
import { TreeBot } from "./TreeBot.js";

/**
 * M17 ticket 06's pieces, one question each, on small Tracks: the guard's
 * copy of the movement model, the ground probe that tells a drop from a
 * wall, the path's margin, and Bots at EASY's worst taken to an edge and
 * over a gap. The whole rule, on the authored Races, is
 * `neverStepsOff.test.ts`.
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
const deck = (s: number, top = TOP, scale = 2) => onTop("kaykit_platform_6x6x1_blue", 0, top, s, { scale });
/** A deck 12 m long from s 0, then `gap` metres of air, then another with a finish sign on it. */
const gapTrack = (gap: number): Track => [deck(6), deck(12 + gap + 6), at("kaykit_signage_finish_wide", 0, TOP, 12 + gap + 8, { scale: 1.25 })];

/** EASY at its slowest and clumsiest, with no fight in it: the Bot that sees itself latest. */
const worstEasy = (seed: string): BotProfile => {
  const { reactionTicks, clumsiness } = BOT_LEVEL_SPREADS.easy;
  return { ...botProfile("easy", seed), reactionTicks: reactionTicks.max, clumsiness: clumsiness.max, aggression: 0 };
};

/** Runs Bots from `starts` as `BotDriver` seats them (a `TreeBot` behind its perception delay) for `seconds`. */
const race = (track: BotTrack, starts: readonly Vec3[], seconds: number): CharacterSnapshot[] => {
  const sim = new RapierSimulation({ ...track.resolved, withDefaultCharacter: false });
  const bots = new Map<string, Bot>();
  starts.forEach((start, i) => {
    const id = `bot-${i}`;
    const seed = `edge-guard:${id}`;
    const profile = worstEasy(seed);
    bots.set(id, withPerceptionDelay(new TreeBot({ seed, profile }), profile, seed));
    sim.addCharacter(id, start);
  });
  try {
    for (let n = 0; n < seconds / TICK_DT; n += 1) {
      const state = sim.snapshot();
      if (Object.values(state.characters).every((c) => c.finishTick !== null)) break;
      const inputs: Record<string, SimInputs> = {};
      for (const [id, bot] of bots) {
        inputs[id] = bot.think({ tick: state.tick + 1, id, self: state.characters[id]!, characters: state.characters, props: state.props, track, rules: RULES });
      }
      sim.tick(inputs, "RUNNING");
    }
    return Object.values(sim.snapshot().characters);
  } finally {
    sim.dispose();
  }
};

describe("the guard's own model of a Bot's motion (M17 ticket 06)", () => {
  it("plays a Tick exactly as the movement model does, on grip and on ice", () => {
    const cases: [Vec3, Vec3, number][] = [
      [{ x: 0, y: 0, z: 0 }, { x: 5.5, y: 0, z: 0 }, 1],
      [{ x: 3, y: 0, z: -2 }, { x: -4.4, y: 0, z: 0 }, 0.001],
      [{ x: -5, y: 0, z: 1 }, { x: 0, y: 0, z: 0 }, 0.001],
      [{ x: 12, y: 0, z: 9 }, { x: 0, y: 0, z: -5.5 }, 0.5],
      [{ x: 40, y: 0, z: 0 }, { x: 5.5, y: 0, z: 0 }, 1],
    ];
    for (const [velocity, wish, grip] of cases) {
      const expected = accelerateVelocity(velocity, wish, MOVE_ACCEL_FACTOR * grip, MOVE_FRICTION_FACTOR * grip);
      const m: Motion = { x: 0, z: 0, vx: velocity.x, vz: velocity.z };
      accelerate(m, wish.x, wish.z, grip);
      expect(m.vx).toBeCloseTo(expected.x, 12);
      expect(m.vz).toBeCloseTo(expected.z, 12);
    }
  });
});

describe("what is floor, and what is a drop (M17 ticket 06)", () => {
  it("finds no floor a metre past a deck's rim, where Detour's own nearest point says there is", () => {
    const track = botTrackOf([deck(6)]);
    // The rim is at x = 6; its navmesh stops a capsule's radius in.
    const past = { x: 6.6, y: TOP, z: -6 };
    const half = { x: 0.3, y: 0.5, z: 0.3 };
    expect(navFloorWithin(track.nav, past, half)).toBeNull();
    expect(navFloorWithin(track.nav, { x: 0, y: TOP, z: -6 }, half)).not.toBeNull();
  });

  it("counts a deck's rim over the air as a drop, and the hole cut round a bumper standing on it as none", () => {
    const track = botTrackOf([deck(6), at("kaykit_ball_red", 0, TOP, 6)]);
    const edges = [...new Set([...navEdgesOf(track.nav).grid.values()].flat())];
    const nearBall = edges.filter((edge) => Math.hypot((edge.ax + edge.bx) / 2, (edge.az + edge.bz) / 2 + 6) < 2.5);
    const onRim = edges.filter((edge) => Math.abs((edge.ax + edge.bx) / 2) > 5);
    expect(nearBall).toEqual([]);
    expect(onRim.length).toBeGreaterThan(0);
  });

  it("moves a path's corner off an edge it hugs, where there is floor to move it to, and never a link's start", () => {
    const track = botTrackOf([deck(6)]);
    const hugging = { x: 5.5, y: TOP, z: -6 };
    const [moved, link] = keepOffEdges(track.nav, [
      { point: hugging, link: null },
      { point: hugging, link: 0 },
    ]);
    // The navmesh's own rim is a radius in from x = 6.
    const rim = Math.max(...[...navEdgesOf(track.nav).grid.values()].flat().map((edge) => Math.max(edge.ax, edge.bx)));
    expect(rim - moved!.point.x).toBeGreaterThanOrEqual(BOT_PATH_EDGE_MARGIN_M - 1e-3);
    expect(link!.point).toBe(hugging);
  });
});

describe("a Bot that sees itself late never steps off (M17 ticket 06, ADR 0129)", () => {
  it("stops on the deck where its path runs out at an edge, however late it sees itself", () => {
    // No jump crosses 7 m: the path ends at the near rim, with the finish past it.
    const track = botTrackOf(gapTrack(7));
    const [end] = race(track, [{ x: 0, y: TOP + 1, z: -2 }], 25);
    expect(end!.fallCount).toBe(0);
    expect(-end!.position.z).toBeGreaterThan(8);
    expect(-end!.position.z).toBeLessThan(12);
  });

  it("takes a jump from a stand by the script that proved it, and lands", () => {
    const track = botTrackOf(gapTrack(2.5));
    const [end] = race(track, [{ x: 0, y: TOP + 1, z: -2 }], 40);
    expect(end!.fallCount).toBe(0);
    expect(end!.finishTick).not.toBeNull();
  });

  it("takes a jump in turn when two arrive at its start together, and neither Falls", () => {
    const track = botTrackOf(gapTrack(2.5));
    const ends = race(track, [{ x: -0.6, y: TOP + 1, z: -2 }, { x: 0.6, y: TOP + 1, z: -2 }], 60);
    for (const end of ends) {
      expect(end.fallCount).toBe(0);
      expect(end.finishTick).not.toBeNull();
    }
  });
});
