import { describe, expect, it } from "vitest";
import { CRITICAL_TIME_LEFT_MS, HUD_THREAT_RADIUS_M, type RoundRules } from "@dont-fall/shared";
import { buildRoundHud, type HudCharacter, type RoundHudInput } from "./roundHud.js";

const RACE: RoundRules = { timeLimitMs: 300_000, fallBehavior: "respawn", survivorTarget: 1 };
const SURVIVAL: RoundRules = { timeLimitMs: 180_000, fallBehavior: "eliminate", survivorTarget: 1 };

const character = (overrides: Partial<HudCharacter> = {}): HudCharacter => ({
  position: { x: 0, y: 0, z: 0 },
  checkpointIndex: null,
  finishTick: null,
  eliminated: false,
  eliminatedTick: null,
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
      expect(hud).toMatchObject({ lastOut: "LATEST", critical: false });
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
});
