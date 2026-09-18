import { describe, expect, it } from "vitest";
import { lengthVec3, vec3, type Vec3 } from "../../math/vec3.js";
import { TICK_DT } from "../../tuning/clock.js";
import { WALL_IMPACT_MIN_SPEED } from "../../tuning/knockdown.js";
import {
  ICE_CRASH_MIN_SPEED,
  MUD_LANDING_KNOCKDOWN_MIN_SPEED,
  MUD_RUN_SLIP_CHANCE_PER_SECOND,
  MUD_SLIP_MIN_SPEED,
  MUD_TURN_SLIP_CHANCE,
  SLIP_IMPULSE,
} from "../../tuning/surfaces.js";
import { DEFAULT_SURFACE, SURFACES, type SurfaceId } from "../../track/Surface.js";
import type { Capsule } from "./Capsule.js";
import { SurfaceController } from "./SurfaceController.js";

/** Neither rule below touches the capsule — they judge velocities against the Surface pushed in. */
const on = (surface: SurfaceId, slipRoll: number, conveyor?: Vec3): SurfaceController => {
  const controller = new SurfaceController({} as Capsule);
  controller.apply({ surface: SURFACES[surface]!, conveyor, volume: undefined, slipRoll }, true);
  return controller;
};

const RUN = 2.4; // mud's top speed, WALK_SPEED × MUD_TOP_SPEED_MULTIPLIER
const RUN_CHANCE_PER_TICK = 1 - (1 - MUD_RUN_SLIP_CHANCE_PER_SECOND) ** TICK_DT;

describe("SurfaceController — mud takes your feet on the run (ADR 0102)", () => {
  it("never below its minimum speed, however unlucky the draw — standing and creeping are safe", () => {
    const creep = vec3(0, 0, -(MUD_SLIP_MIN_SPEED - 0.1));
    expect(on("mud", 0).runningImpact(creep, creep)).toBeUndefined();
  });

  it("running carries this tick's share of the chance per second, and sprawls the way it runs", () => {
    const run = vec3(0, 0, -RUN);
    const impulse = on("mud", RUN_CHANCE_PER_TICK * 0.99).runningImpact(run, run);
    expect(impulse).toBeDefined();
    expect(impulse!.z).toBeCloseTo(-SLIP_IMPULSE);
    expect(on("mud", RUN_CHANCE_PER_TICK * 1.01).runningImpact(run, run)).toBeUndefined();
  });

  it("a sharp turn is a coin flip, and the sprawl goes the way the Character was going", () => {
    const north = vec3(0, 0, -RUN);
    const south = vec3(0, 0, RUN);
    const impulse = on("mud", MUD_TURN_SLIP_CHANCE - 0.01).runningImpact(north, south);
    expect(impulse).toBeDefined();
    expect(impulse!.z).toBeCloseTo(-SLIP_IMPULSE);
    expect(on("mud", MUD_TURN_SLIP_CHANCE + 0.01).runningImpact(north, south)).toBeUndefined();
  });

  it("a strafe is steering, not a turn — a right angle only carries the run's own chance", () => {
    const roll = MUD_TURN_SLIP_CHANCE - 0.01;
    expect(on("mud", roll).runningImpact(vec3(0, 0, -RUN), vec3(RUN, 0, 0))).toBeUndefined();
  });

  it("a belt carrying a Character that stands still is not running", () => {
    const belt = vec3(0, 0, -4);
    expect(on("mud", 0, belt).runningImpact(belt, belt)).toBeUndefined();
  });

  it("a hard landing in mud may take its feet, as on ice; a hop never does", () => {
    const arriving = vec3(0, -MUD_LANDING_KNOCKDOWN_MIN_SPEED, -RUN);
    const impulse = on("mud", 0.01).landingImpact(arriving, MUD_LANDING_KNOCKDOWN_MIN_SPEED + 1);
    expect(impulse && lengthVec3(impulse)).toBeCloseTo(SLIP_IMPULSE);
    expect(on("mud", 0.01).landingImpact(arriving, MUD_LANDING_KNOCKDOWN_MIN_SPEED - 1)).toBeUndefined();
  });

  it("no other Surface has a running hazard", () => {
    const run = vec3(0, 0, -RUN);
    for (const surface of [DEFAULT_SURFACE, "ice", "bounce"]) {
      expect(on(surface, 0).runningImpact(run, vec3(0, 0, RUN))).toBeUndefined();
    }
  });
});

describe("SurfaceController — on ice any crash takes your feet, another Character included (ADR 0102)", () => {
  it("ice knocks a Character down from its own low speed, whatever it ran into", () => {
    expect(on("ice", 1).crashMinSpeed(false)).toBe(ICE_CRASH_MIN_SPEED);
    expect(on("ice", 1).crashMinSpeed(true)).toBe(ICE_CRASH_MIN_SPEED);
  });

  it("everywhere else a wall takes the wall-Impact speed, and running into a Character never downs the runner", () => {
    for (const surface of [DEFAULT_SURFACE, "mud", "bounce"]) {
      expect(on(surface, 1).crashMinSpeed(false)).toBe(WALL_IMPACT_MIN_SPEED);
      expect(on(surface, 1).crashMinSpeed(true)).toBeUndefined();
    }
  });
});

describe("SurfaceController — the take-off Surface governs the air (ADR 0094 amendment, found live 2026-09-18)", () => {
  it("carries the top-speed cap and grip while airborne, resets the belt, and adopts the landing floor's own", () => {
    const controller = new SurfaceController({} as Capsule);
    controller.apply({ surface: SURFACES.mud!, conveyor: vec3(1, 0, 0), volume: undefined, slipRoll: 1 }, true);
    const mudCap = controller.surfaceTopSpeedMultiplier;
    const mudGrip = controller.surfaceGrip;
    expect(mudCap).toBeLessThan(1);

    // Airborne: the resolved Surface is always the default (no ground handle) —
    // the movement pair carries, everything positional resets.
    controller.apply({ surface: SURFACES[DEFAULT_SURFACE]!, conveyor: undefined, volume: undefined, slipRoll: 1 }, false);
    expect(controller.surfaceTopSpeedMultiplier).toBe(mudCap);
    expect(controller.surfaceGrip).toBe(mudGrip);
    expect(controller.conveyorVelocity).toEqual(vec3(0, 0, 0));

    // Landing on plain floor adopts its own pair — the carry ends at the ground.
    controller.apply({ surface: SURFACES[DEFAULT_SURFACE]!, conveyor: undefined, volume: undefined, slipRoll: 1 }, true);
    expect(controller.surfaceTopSpeedMultiplier).toBe(1);
    expect(controller.surfaceGrip).toBe(1);
  });
});
