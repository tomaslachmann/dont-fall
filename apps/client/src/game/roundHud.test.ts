import { describe, expect, it } from "vitest";
import {
  CRITICAL_TIME_LEFT_MS,
  DASH_COOLDOWN_MS,
  DEFAULT_BINDINGS,
  GRAB_STRUGGLE_WINDOW_TICKS,
  HUD_THREAT_RADIUS_M,
  SPIN_OVERSPIN_MS,
  SPIN_WINDUP_MS,
  type RoundRules,
} from "@dont-fall/shared";
import { buildRoundHud, type HudCharacter, type RoundHudInput } from "./roundHud.js";

const RACE: RoundRules = { timeLimitMs: 300_000, fallBehavior: "respawn", survivorTarget: 1 };
const SURVIVAL: RoundRules = { timeLimitMs: 180_000, fallBehavior: "eliminate", survivorTarget: 1 };

const character = (overrides: Partial<HudCharacter> = {}): HudCharacter => ({
  position: { x: 0, y: 0, z: 0 },
  checkpointIndex: null,
  finishTick: null,
  eliminated: false,
  eliminatedTick: null,
  dashCooldownMs: 0,
  grabbingId: null,
  carryingProp: null,
  heldByGrabberId: null,
  heldPhase: null,
  holdEndsTick: null,
  escapeProgress: 0,
  ...overrides,
});

const input = (overrides: Partial<RoundHudInput> = {}): RoundHudInput => ({
  myId: "me",
  phase: "RUNNING",
  roundRules: RACE,
  timeLeftMs: RACE.timeLimitMs,
  characters: { me: character() },
  liveRace: null,
  checkpoints: 7,
  nicknameOf: (id) => id.toUpperCase(),
  propLabelOf: (index) => ["CONE", "BALL"][index] ?? "PROP",
  bombs: [],
  leftIds: [],
  tick: 1000,
  predicted: { escapeProgress: 0, spinMs: 0 },
  bindings: DEFAULT_BINDINGS,
  ...overrides,
});

describe("buildRoundHud", () => {
  it("is null outside RUNNING, and for a client with no Character in the Round", () => {
    expect(buildRoundHud(input({ phase: "COUNTDOWN" }))).toBeNull();
    expect(buildRoundHud(input({ phase: "ROUND_END" }))).toBeNull();
    expect(buildRoundHud(input({ characters: { other: character() } }))).toBeNull();
  });

  describe("in a Race", () => {
    it("reads placement, split and Checkpoints off the server's live Race", () => {
      const hud = buildRoundHud(
        input({
          characters: { me: character({ checkpointIndex: 3 }), lead: character({ position: { x: 0, y: 0, z: -50 } }) },
          liveRace: { places: { lead: 1, me: 2 }, splits: { me: { checkpointIndex: 3, gapMs: 2478 } } },
        }),
      );
      expect(hud).toMatchObject({ kind: "race", place: 2, field: 2, checkpointsReached: 4, checkpoints: 7, splitMs: 2478 });
    });

    it("floors the clock to tenths, so a frame between two snapshots changes nothing", () => {
      const at = (timeLeftMs: number) => buildRoundHud(input({ timeLeftMs }));
      expect(at(RACE.timeLimitMs - 84_382)).toMatchObject({ elapsedMs: 84_300 });
      expect(at(RACE.timeLimitMs - 84_333)).toEqual(at(RACE.timeLimitMs - 84_399));
    });

    it("names who is right behind you", () => {
      const hud = buildRoundHud(
        input({
          characters: {
            me: character(),
            chaser: character({ position: { x: 0, y: 0, z: HUD_THREAT_RADIUS_M - 1 } }),
          },
          liveRace: { places: { me: 1, chaser: 2 }, splits: {} },
        }),
      );
      expect(hud).toMatchObject({ threat: { id: "chaser", nickname: "CHASER" } });
    });

    it("has no placement, split or threat before the server's live Race arrives", () => {
      expect(buildRoundHud(input())).toMatchObject({ place: null, splitMs: null, threat: null, checkpointsReached: 0 });
    });
  });

  describe("in Survival", () => {
    const survival = (overrides: Partial<RoundHudInput> = {}) =>
      buildRoundHud(input({ roundRules: SURVIVAL, timeLeftMs: SURVIVAL.timeLimitMs, ...overrides }));

    it("counts who is left out of who started, you first", () => {
      const hud = survival({
        characters: {
          b: character(),
          me: character(),
          a: character(),
          out: character({ eliminated: true, eliminatedTick: 90 }),
        },
      });
      expect(hud).toMatchObject({ kind: "survival", remaining: 3, startedWith: 4, alive: ["me", "a", "b"], youAlive: true });
    });

    it("names the most recent Elimination", () => {
      const hud = survival({
        characters: {
          me: character(),
          first: character({ eliminated: true, eliminatedTick: 90 }),
          latest: character({ eliminated: true, eliminatedTick: 140 }),
          spare: character(),
          extra: character(),
        },
      });
      expect(hud).toMatchObject({ lastOut: "LATEST", lastOutLeft: false, critical: false });
    });

    it("says so when the last one out left the Match rather than fell (ADR 0110)", () => {
      const hud = survival({
        characters: { me: character(), gone: character({ eliminated: true, eliminatedTick: 140 }) },
        leftIds: ["gone"],
      });
      expect(hud).toMatchObject({ lastOut: "GONE", lastOutLeft: true });
    });

    it("floors the survived clock to whole seconds", () => {
      expect(survival({ timeLeftMs: SURVIVAL.timeLimitMs - 272_900 })).toMatchObject({ survivedMs: 272_000 });
    });

    it("warns one Fall from the Survivor Target, and when the clock runs low", () => {
      const four = { me: character(), a: character(), b: character(), c: character() };
      expect(survival({ characters: four })).toMatchObject({ critical: false });
      expect(survival({ characters: { me: character(), a: character() } })).toMatchObject({ critical: true });
      expect(survival({ characters: four, timeLeftMs: CRITICAL_TIME_LEFT_MS })).toMatchObject({ critical: true });
    });

    it("still reads while you are out, with you no longer among the alive", () => {
      const hud = survival({
        characters: { me: character({ eliminated: true, eliminatedTick: 50 }), a: character(), b: character() },
      });
      expect(hud).toMatchObject({ remaining: 2, alive: ["a", "b"], youAlive: false, lastOut: "ME" });
    });
  });

  describe("the Dash meter (ADR 0092)", () => {
    it("reads your own recharge, on both Round types", () => {
      const halfway = { me: character({ dashCooldownMs: DASH_COOLDOWN_MS / 2 }) };
      expect(buildRoundHud(input({ characters: halfway }))).toMatchObject({ kind: "race", dashCharge: 0.5 });
      expect(buildRoundHud(input({ roundRules: SURVIVAL, characters: halfway }))).toMatchObject({
        kind: "survival",
        dashCharge: 0.5,
      });
    });

    it("rounds the bar to twentieths, so a fifteen-second wait raises React twenty times and not 450", () => {
      // 1/3 of the way through the cooldown — two neighbouring milliseconds
      // must land on the same drawn value, or the JSON dedupe never dedupes.
      const at = (ms: number) => buildRoundHud(input({ characters: { me: character({ dashCooldownMs: ms }) } }))!;
      expect(at(DASH_COOLDOWN_MS / 3).dashCharge).toBe(at(DASH_COOLDOWN_MS / 3 + 1).dashCharge);
      expect(at(DASH_COOLDOWN_MS / 3).dashCharge).toBe(0.65);
    });

    it("says ready only when the cooldown is actually spent — never off the rounded bar", () => {
      // A hair of cooldown left rounds the bar up to a full 1, and must still
      // not promise a Dash the simulation would refuse.
      const nearly = buildRoundHud(input({ characters: { me: character({ dashCooldownMs: 1 }) } }))!;
      expect(nearly.dashCharge).toBe(1);
      expect(nearly.dashReady).toBe(false);
      expect(buildRoundHud(input({ characters: { me: character({ dashCooldownMs: 0 }) } }))!.dashReady).toBe(true);
    });

    it("counts the recharge in whole seconds, rounded up, and names the Dash's key (ADR 0110)", () => {
      const hud = buildRoundHud(input({ characters: { me: character({ dashCooldownMs: 11_200 }) } }))!;
      expect(hud.dashRechargeS).toBe(12);
      expect(hud.dashKey).toBe("Shift");
      expect(buildRoundHud(input({ characters: { me: character({ dashCooldownMs: 0 }) } }))!.dashRechargeS).toBe(0);
    });
  });
});

describe("buildRoundHud — a hold (ADR 0104)", () => {
  it("is no hold at all while nobody holds anybody", () => {
    expect(buildRoundHud(input())!.hold).toBeNull();
  });

  it("tells the one held who has it, the meter from its own prediction, and the keys it has bound", () => {
    const hud = buildRoundHud(
      input({
        characters: {
          me: character({ heldByGrabberId: "floppo", heldPhase: "struggle", holdEndsTick: 1000 + GRAB_STRUGGLE_WINDOW_TICKS / 2, escapeProgress: 0.1 }),
          floppo: character({ grabbingId: "me" }),
        },
        predicted: { escapeProgress: 0.62, spinMs: 0 },
        bindings: { ...DEFAULT_BINDINGS, left: ["KeyQ"], right: ["ArrowRight"] },
      }),
    )!;
    expect(hud.hold).toEqual({ role: "held", by: "FLOPPO", phase: "struggle", escape: 0.6, wiggleKeys: ["Q", "Right"] });
  });

  it("tells the one holding whom, how close they are to getting free, its own wind-up, and the keys to Spin and let go", () => {
    const hud = buildRoundHud(
      input({
        characters: {
          me: character({ grabbingId: "floppo" }),
          floppo: character({ heldByGrabberId: "me", heldPhase: "limp", holdEndsTick: 1000 + 44, escapeProgress: 0.33 }), // 1.467 s left
        },
        predicted: { escapeProgress: 0, spinMs: SPIN_WINDUP_MS + SPIN_OVERSPIN_MS / 2 },
      }),
    )!;
    expect(hud.hold).toEqual({
      role: "grabbing",
      holding: "FLOPPO",
      phase: "limp",
      escape: 0.35,
      timeLeftMs: 1400,
      windup: 1,
      overspin: 0.5,
      spinKey: "F",
      letGoKey: "G",
    });
  });

  it("shows a dash for an action the Player has unbound, rather than a key that does nothing", () => {
    const hud = buildRoundHud(
      input({
        characters: { me: character({ grabbingId: "x" }), x: character({ heldByGrabberId: "me", heldPhase: "struggle", holdEndsTick: 1010 }) },
        bindings: { ...DEFAULT_BINDINGS, hit: [] },
      }),
    )!;
    expect(hud.hold).toMatchObject({ spinKey: "—", letGoKey: "G" });
  });
});

describe("buildRoundHud — carrying a Prop (ADR 0125)", () => {
  it("names what is carried and how to throw it, with no Struggle and no window", () => {
    const hud = buildRoundHud(input({ characters: { me: character({ carryingProp: 1 }) }, predicted: { escapeProgress: 0, spinMs: 0 } }));

    expect(hud?.hold).toEqual({
      role: "carrying",
      holding: "BALL",
      windup: 0,
      overspin: 0,
      spinKey: expect.any(String),
      letGoKey: expect.any(String),
    });
  });

  it("counts a lit Bomb's fuse down to tenths (ADR 0126)", () => {
    const hud = buildRoundHud(
      input({
        characters: { me: character({ carryingProp: 1 }) },
        bombs: [{ propIndex: 1, detonateTick: 1000 + 50 }],
        tick: 1000,
      }),
    );

    expect(hud?.hold).toMatchObject({ role: "carrying", fuseMs: 1600 });
  });
});

