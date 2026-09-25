import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveRoundRules } from "../match/RoundRules.js";
import type { Vec3 } from "../math/vec3.js";
import { MOVING_SEGMENT_STAGGER_SPEED } from "../simulation/MovingSegment.js";
import { RapierSimulation } from "../simulation/RapierSimulation.js";
import type { CharacterSnapshot } from "../state/SimState.js";
import { at, onTop, spin } from "../track/authoring.js";
import type { Module } from "../track/Module.js";
import { resolveTrack } from "../track/resolveTrack.js";
import type { Track } from "../track/Track.js";
import { BOT_BRAKE_MIN_SPEED, BOT_HOLD_MARGIN_M, BOT_PLAN_HELD_MIN_TURN_DEG } from "../tuning/bots.js";
import { CAPSULE_RADIUS } from "../tuning/character.js";
import { buildBotTrack, disposeBotTrack, type BotTrack, type BotWorldView } from "./Bot.js";
import type { HookContext } from "./hooks.js";
import { LocalMotionPlanner, type PlanAsk } from "./localMotion.js";
import { navCorners } from "./navMesh.js";
import { botProfile } from "./profile.js";
import { loadTestLibrary } from "./sectionHarness.js";

/**
 * M17 ticket 14 (ADR 0130): the local motion planner, one question each on
 * a lane with one bar spinning about its middle. The whole rule, with twelve
 * Bots on the authored legs, is the 07m stagger log's numbers, in the ticket.
 */

const RULES = resolveRoundRules({ timeLimitMs: 300_000, fallBehavior: "respawn", survivorTarget: 1 });
const TOP = 4;
/** A lane deck 12 m long and 12 m wide, centred `s` metres down the course. */
const lane = (s: number, extra: { start?: boolean } = {}) => onTop("kaykit_platform_6x6x1_blue", 0, TOP, s, { scale: 2, ...extra });
/** A bar 3.6 m either way, spinning about the lane's centre at `s`. */
const bar = (s: number, speed: number) => at("kaykit_barrier_4x1x1_blue", 0, TOP + 0.02, s, { scale: 1.8, motion: spin(speed) });
const finish = (s: number) => [lane(s + 2), at("kaykit_signage_finish_wide", 0, TOP, s, { scale: 1.25 })];
/** The bar's middle, in world space (`at` puts `s` down the course at `-z`). */
const BAR_S = 18;
const PIVOT: Vec3 = { x: 0, y: TOP, z: -BAR_S };
const GROW = CAPSULE_RADIUS + BOT_HOLD_MARGIN_M;

const trackWith = (speed: number): Track => [lane(6, { start: true }), lane(18), bar(BAR_S, speed), lane(30), ...finish(34)];

let library: Record<string, Module>;
const built: BotTrack[] = [];
beforeAll(async () => {
  library = await loadTestLibrary();
}, 120_000);
afterAll(() => built.forEach(disposeBotTrack));

/** A Bot standing at `position` (its feet on the lane), seen as it is, with its path down the lane. */
const standing = (track: BotTrack, position: Vec3, tick = 30): { ctx: HookContext; sim: RapierSimulation } => {
  const sim = new RapierSimulation({ ...track.resolved, withDefaultCharacter: false, motionClock: 0 });
  sim.addCharacter("bot", position);
  for (let n = 0; n < tick; n += 1) sim.tick({}, "RUNNING");
  const state = sim.snapshot();
  const self: CharacterSnapshot = state.characters.bot!;
  expect(self.grounded).toBe(true);
  const view: BotWorldView = {
    tick: state.tick + 1,
    id: "bot",
    self,
    characters: state.characters,
    props: state.props,
    bombs: state.bombs ?? [],
    track,
    rules: RULES,
    runningFromTick: sim.motionClock,
    fragile: state.fragile,
  };
  const goal = { x: 0, y: TOP, z: -34 };
  const path = navCorners(track.nav, self.position, goal) ?? [];
  expect(path.length).toBeGreaterThan(1);
  const profile = botProfile("hard", "planner-test");
  return { sim, ctx: { tick: view.tick, view, self, clock: view.runningFromTick ?? null, profile, stale: { min: 0, max: 0 }, seed: "planner-test", path, corner: 0 } };
};

const ask = (ctx: HookContext, forwardRefused = true): PlanAsk => ({
  ctx,
  asked: { x: 0, y: 0, z: -1 },
  near: ctx.view.track.moving.sweepers,
  grow: GROW,
  deck: null,
  forwardRefused,
});

describe("the local motion planner (M17 ticket 14)", () => {
  /** The first Tick from `from` at which the bar occupies the capsule standing at `p`. */
  const reachedAt = (track: BotTrack, p: Vec3, from: number): number => {
    const body = track.moving.sweepers[0]!;
    for (let tick = from; tick < from + 200; tick += 1) if (track.moving.occupies(body.index, tick, 0, p, GROW)) return tick;
    throw new Error("the bar never reaches the stand");
  };

  it("where the bar only pushes, the stand is only pushed; a walk into the arm is Staggered by its own speed and never chosen", () => {
    // 1.5 rad/s: 6.0 u/s where the Bot stands, under the Stagger speed. It stands 4 m from the pivot, inside the grown swath,
    // with the arm 10 Ticks off. A walk against the arm's turn brings the walk's own 5.5 u/s to the closing speed (07m).
    const track = buildBotTrack(resolveTrack(library, trackWith(1.5)));
    built.push(track);
    expect(track.moving.sweepers.length).toBe(1);
    const stand = { x: 0, y: TOP + 1, z: PIVOT.z + 4 };
    const decideAt = reachedAt(track, stand, 40) - 10;
    const { ctx, sim } = standing(track, stand, decideAt - 1);
    try {
      expect(ctx.tick).toBe(decideAt);
      const planner = new LocalMotionPlanner("planner-test");
      const choice = planner.choose(ask(ctx));
      const standing = choice.scored.find((s) => s.candidate.name === "stand")!;
      expect(standing.staggered).toBe(false);
      expect(standing.contact).toBeGreaterThan(0);
      expect(standing.edge).toBe(false);
      const intoTheArm = choice.scored.filter((s) => s.staggered);
      expect(intoTheArm.length).toBeGreaterThan(0);
      const chosen = choice.scored.find((s) => s.candidate === choice.candidate)!;
      expect(chosen.staggered).toBe(false);
      expect(chosen.edge).toBe(false);
      for (const s of intoTheArm) expect(s.score).toBeLessThan(standing.score);
    } finally {
      sim.dispose();
    }
  });

  it("where the stand would be Staggered, a move whose rollout is not is chosen", () => {
    // 2.7 rad/s: 10.8 u/s where the Bot stands, 4 m from the pivot, with the arm 10 Ticks off: a walk away gets clear in time.
    const track = buildBotTrack(resolveTrack(library, trackWith(2.7)));
    built.push(track);
    const body = track.moving.sweepers[0]!;
    const stand = { x: 0, y: TOP + 1, z: PIVOT.z + 4 };
    const hitAt = reachedAt(track, stand, 40);
    const decideAt = hitAt - 10;
    const { ctx, sim } = standing(track, stand, decideAt - 1);
    try {
      expect(ctx.tick).toBe(decideAt);
      const planner = new LocalMotionPlanner("planner-test");
      const choice = planner.choose(ask(ctx));
      const standing = choice.scored.find((s) => s.candidate.name === "stand")!;
      expect(standing.staggered).toBe(true);
      expect(choice.candidate.name).not.toBe("stand");
      const chosen = choice.scored.find((s) => s.candidate === choice.candidate)!;
      expect(chosen.staggered).toBe(false);
      expect(chosen.edge).toBe(false);
      // The speed rule is the simulation's: the bar's own speed there is over the threshold with the Bot standing still.
      const v = track.moving.velocityAt(body.index, hitAt, ctx.clock, ctx.self.position);
      expect(Math.hypot(v.x, v.z)).toBeGreaterThan(MOVING_SEGMENT_STAGGER_SPEED);
    } finally {
      sim.dispose();
    }
  });

  it("a walk toward the lane's edge stops at the guard's margin and stands, and only a push over it is a Fall", () => {
    const track = buildBotTrack(resolveTrack(library, trackWith(2.7)));
    built.push(track);
    // Beside the lane's edge (x 6), out of the bar's reach.
    const { ctx, sim } = standing(track, { x: 5.2, y: TOP + 1, z: PIVOT.z + 6 });
    try {
      const planner = new LocalMotionPlanner("planner-test");
      const choice = planner.choose(ask(ctx));
      const toTheEdge = choice.scored.filter((s) => s.stopped);
      expect(toTheEdge.length).toBeGreaterThan(0);
      // Every candidate the guard would stop heads out toward the edge, and none is a Fall: the guard never sends that walk.
      for (const s of toTheEdge) {
        expect(s.candidate.direction!.x).toBeGreaterThan(0);
        expect(s.edge).toBe(false);
        // Stopped short of the margin, it got nowhere near a walk's reach.
        expect(Math.abs(s.progress)).toBeLessThan(1);
      }
      expect(choice.scored.some((s) => s.edge)).toBe(false);
      const chosen = choice.scored.find((s) => s.candidate === choice.candidate)!;
      expect(chosen.edge).toBe(false);
    } finally {
      sim.dispose();
    }
  });

  it("with the way forward refused only the stand and turns of the least held turn are tried, and the same ask chooses the same", () => {
    const track = buildBotTrack(resolveTrack(library, trackWith(1.5)));
    built.push(track);
    const { ctx, sim } = standing(track, { x: 0, y: TOP + 1, z: PIVOT.z + 4 });
    try {
      const planner = new LocalMotionPlanner("planner-test");
      const held = planner.choose(ask(ctx));
      for (const { candidate } of held.scored) {
        if (candidate.direction === null) continue;
        expect(Math.abs(Number(candidate.name))).toBeGreaterThanOrEqual(BOT_PLAN_HELD_MIN_TURN_DEG);
      }
      const free = new LocalMotionPlanner("planner-test").choose(ask(ctx, false));
      expect(free.scored.some((s) => s.candidate.name === "0")).toBe(true);
      expect(free.scored.length).toBeGreaterThan(held.scored.length);
      const again = new LocalMotionPlanner("planner-test").choose(ask(ctx));
      expect(again.candidate.name).toBe(held.candidate.name);
      expect(again.scored.map((s) => s.score)).toEqual(held.scored.map((s) => s.score));
    } finally {
      sim.dispose();
    }
  });

  it("a stand brakes against the Bot's own velocity on a slick floor until it is too slow to hurt, and is a zero move on a floor with grip", () => {
    const planner = new LocalMotionPlanner("planner-test");
    const moving = { velocity: { x: 3, y: 0, z: 4 } } as CharacterSnapshot;
    const brake = planner.brake(moving, 0.001);
    expect(brake.moveDirection.x).toBeCloseTo(-0.6, 6);
    expect(brake.moveDirection.z).toBeCloseTo(-0.8, 6);
    expect(brake.dash).toBe(false);
    const slow = { velocity: { x: BOT_BRAKE_MIN_SPEED * 0.5, y: 0, z: 0 } } as CharacterSnapshot;
    expect(planner.brake(slow, 0.001).moveDirection).toEqual({ x: 0, y: 0, z: 0 });
    // With grip the body stops in the Tick on its own, and the velocity a Bot sees is stale: a push against it would be a walk back.
    expect(planner.brake(moving, 1).moveDirection).toEqual({ x: 0, y: 0, z: 0 });
  });
});
