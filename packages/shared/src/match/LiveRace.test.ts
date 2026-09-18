import { describe, expect, it } from "vitest";
import { TICK_MS } from "../tuning/clock.js";
import { CRITICAL_TIME_LEFT_MS, HUD_THREAT_RADIUS_M } from "../tuning/hud.js";
import {
  checkpointSplits,
  liveRacePlaces,
  recordCheckpointArrivals,
  survivalCritical,
  threatBehind,
  type CheckpointArrivals,
  type RaceTargets,
  type Racer,
} from "./LiveRace.js";

const at = (z: number, x = 0) => ({ x, y: 0, z });

/** Three Checkpoints along -z every 10 m, the finish at z = -40. */
const TARGETS: RaceTargets = { checkpoints: [at(-10), at(-20), at(-30)], finishes: [at(-40)] };

const racer = (overrides: Partial<Racer> = {}): Racer => ({
  position: at(0),
  checkpointIndex: null,
  finishTick: null,
  ...overrides,
});

describe("liveRacePlaces", () => {
  it("ranks runners by the Checkpoint reached, then by distance to the next one", () => {
    const places = liveRacePlaces(
      {
        back: racer({ position: at(-2) }),
        front: racer({ position: at(-25), checkpointIndex: 1 }),
        middle: racer({ position: at(-15), checkpointIndex: 0 }),
        closer: racer({ position: at(-8) }),
      },
      TARGETS,
    );
    expect(places).toEqual({ front: 1, middle: 2, closer: 3, back: 4 });
  });

  it("puts finishers ahead of every runner, by finish Tick, sharing one Tick", () => {
    const places = liveRacePlaces(
      {
        runner: racer({ position: at(-39), checkpointIndex: 2 }),
        second: racer({ finishTick: 120 }),
        firstA: racer({ finishTick: 100 }),
        firstB: racer({ finishTick: 100 }),
      },
      TARGETS,
    );
    expect(places).toEqual({ firstA: 1, firstB: 1, second: 3, runner: 4 });
  });

  it("puts the Eliminated behind everyone still running, however far they got", () => {
    const places = liveRacePlaces(
      {
        gone: racer({ position: at(-35), checkpointIndex: 2, eliminated: true }),
        runner: racer({ position: at(-1) }),
      },
      TARGETS,
    );
    expect(places).toEqual({ runner: 1, gone: 2 });
  });

  it("heads for the nearest Finish Zone once every Checkpoint is behind", () => {
    const targets: RaceTargets = { checkpoints: [at(-10)], finishes: [at(-40, -20), at(-40, 20)] };
    const places = liveRacePlaces(
      {
        nearRight: racer({ position: at(-38, 18), checkpointIndex: 0 }),
        middle: racer({ position: at(-38, 0), checkpointIndex: 0 }),
      },
      targets,
    );
    expect(places).toEqual({ nearRight: 1, middle: 2 });
  });
});

describe("recordCheckpointArrivals", () => {
  it("stamps a Checkpoint's first arrival and never moves it", () => {
    const arrivals: CheckpointArrivals = {};
    recordCheckpointArrivals(arrivals, { a: { checkpointIndex: null } }, 10);
    recordCheckpointArrivals(arrivals, { a: { checkpointIndex: 0 } }, 20);
    recordCheckpointArrivals(arrivals, { a: { checkpointIndex: 0 } }, 30);
    expect(arrivals).toEqual({ a: [20] });
  });

  it("leaves a hole for a Checkpoint skipped past", () => {
    const arrivals: CheckpointArrivals = {};
    recordCheckpointArrivals(arrivals, { a: { checkpointIndex: 0 } }, 5);
    recordCheckpointArrivals(arrivals, { a: { checkpointIndex: 2 } }, 40);
    expect(arrivals.a?.[0]).toBe(5);
    expect(arrivals.a?.[1]).toBeUndefined();
    expect(arrivals.a?.[2]).toBe(40);
  });
});

describe("checkpointSplits", () => {
  it("reads behind the first arrival as positive, and the first as negative once a second arrives", () => {
    const arrivals: CheckpointArrivals = { lead: [100, 200], chase: [130, 260] };
    const splits = checkpointSplits(arrivals, { lead: { checkpointIndex: 1 }, chase: { checkpointIndex: 1 } });
    expect(splits.lead).toEqual({ checkpointIndex: 1, gapMs: Math.round(-60 * TICK_MS) });
    expect(splits.chase).toEqual({ checkpointIndex: 1, gapMs: Math.round(60 * TICK_MS) });
  });

  it("has no split for a Character alone at its Checkpoint so far", () => {
    const arrivals: CheckpointArrivals = { lead: [100, 200], chase: [130] };
    const splits = checkpointSplits(arrivals, { lead: { checkpointIndex: 1 }, chase: { checkpointIndex: 0 } });
    expect(splits.lead).toBeUndefined();
    expect(splits.chase).toEqual({ checkpointIndex: 0, gapMs: Math.round(30 * TICK_MS) });
  });

  it("measures against the earliest arrival, not the next one", () => {
    const arrivals: CheckpointArrivals = { a: [100], b: [110], c: [150] };
    const characters = { a: { checkpointIndex: 0 }, b: { checkpointIndex: 0 }, c: { checkpointIndex: 0 } };
    expect(checkpointSplits(arrivals, characters).c?.gapMs).toBe(Math.round(50 * TICK_MS));
  });

  it("reads zero for arrivals on the same Tick", () => {
    const arrivals: CheckpointArrivals = { a: [100], b: [100] };
    const splits = checkpointSplits(arrivals, { a: { checkpointIndex: 0 }, b: { checkpointIndex: 0 } });
    expect(splits.a?.gapMs).toBe(0);
  });

  it("ignores arrivals from a Character no longer in the Round", () => {
    const arrivals: CheckpointArrivals = { a: [100], gone: [50] };
    expect(checkpointSplits(arrivals, { a: { checkpointIndex: 0 } })).toEqual({});
  });
});

describe("threatBehind", () => {
  const places = { me: 2, next: 3, far: 4, lead: 1 };

  it("names the Character placed directly behind you when it is close", () => {
    const characters = {
      lead: racer({ position: at(-20) }),
      me: racer({ position: at(-10) }),
      next: racer({ position: at(-10 + HUD_THREAT_RADIUS_M - 1) }),
      far: racer({ position: at(-9) }),
    };
    expect(threatBehind("me", places, characters)).toBe("next");
  });

  it("names nobody when the next one behind is out of reach", () => {
    const characters = {
      lead: racer({ position: at(-20) }),
      me: racer({ position: at(-10) }),
      next: racer({ position: at(-10 + HUD_THREAT_RADIUS_M + 1) }),
      far: racer({ position: at(-10 + HUD_THREAT_RADIUS_M + 2) }),
    };
    expect(threatBehind("me", places, characters)).toBeNull();
  });

  it("skips a finisher or the Eliminated, and stops once you have finished", () => {
    const characters = {
      lead: racer({ position: at(-20) }),
      me: racer({ position: at(-10) }),
      next: racer({ position: at(-10), eliminated: true }),
      far: racer({ position: at(-11) }),
    };
    expect(threatBehind("me", places, characters)).toBe("far");
    expect(threatBehind("me", places, { ...characters, me: racer({ position: at(-10), finishTick: 90 }) })).toBeNull();
  });
});

describe("survivalCritical", () => {
  it("lights one Fall from the Survivor Target", () => {
    expect(survivalCritical(3, 1, 120_000)).toBe(false);
    expect(survivalCritical(2, 1, 120_000)).toBe(true);
  });

  it("lights when the clock runs low, however many are left", () => {
    expect(survivalCritical(8, 1, CRITICAL_TIME_LEFT_MS + 1)).toBe(false);
    expect(survivalCritical(8, 1, CRITICAL_TIME_LEFT_MS)).toBe(true);
  });
});
