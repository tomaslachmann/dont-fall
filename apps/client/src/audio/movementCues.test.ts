import { COYOTE_MS, DASH_COOLDOWN_MS, JUMP_VELOCITY } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { LANDING_MIN_AIRBORNE_MS, TAKEOFF_MIN_SPEED } from "../render/jumpSequence.js";
import {
  DASH_RESTART_MIN_MS,
  FALL_WHISTLE_MIN_LEAD,
  fallWhistleY,
  MovementCues,
  RESPAWN_REFIRE_MIN_MS,
  SPRING_REFIRE_MIN_MS,
  type MovementFrame,
} from "./movementCues.js";

const FALL_Y = -3;

/** Standing on a deck at the origin, unless `over` says otherwise. */
const frame = (nowMs: number, over: Partial<Omit<MovementFrame, "nowMs">> & { vy?: number; y?: number } = {}): MovementFrame => {
  const { vy, y, ...rest } = over;
  return {
    position: { x: 0, y: y ?? 1, z: 0 },
    velocity: { x: 0, y: vy ?? 0, z: 0 },
    grounded: true,
    motionState: "Controlled",
    dashing: false,
    launchPadEpoch: 0,
    respawnCount: 0,
    ...rest,
    nowMs,
  };
};

const air = (nowMs: number, vy: number, over: Partial<Omit<MovementFrame, "nowMs">> & { y?: number } = {}): MovementFrame =>
  frame(nowMs, { grounded: false, vy, y: 2, ...over });

describe("MovementCues (M14 ticket 05)", () => {
  describe("takeoff", () => {
    it("is the first airborne frame after standing, rising fast enough, from where it stood", () => {
      const cues = new MovementCues(FALL_Y);
      cues.update("a", frame(0));
      expect(cues.update("a", air(16, JUMP_VELOCITY)).takeoff).toEqual({ from: { x: 0, y: 1, z: 0 } });
      expect(cues.update("a", air(33, JUMP_VELOCITY - 1)).takeoff).toBeNull();
    });

    it("is not walking off a ledge", () => {
      const cues = new MovementCues(FALL_Y);
      cues.update("a", frame(0));
      expect(cues.update("a", air(16, 0)).takeoff).toBeNull();
      expect(cues.update("a", air(33, TAKEOFF_MIN_SPEED - 0.1)).takeoff).toBeNull();
    });

    it("counts a coyote jump off the ledge just walked off, and not a rise long after", () => {
      const cues = new MovementCues(FALL_Y);
      cues.update("a", frame(0));
      cues.update("a", air(16, -0.5));
      expect(cues.update("a", air(16 + COYOTE_MS, JUMP_VELOCITY)).takeoff).not.toBeNull();

      const late = new MovementCues(FALL_Y);
      late.update("a", frame(0));
      late.update("a", air(16, -8));
      // Thrown back up well after leaving the ground: a bounce, not a jump.
      expect(late.update("a", air(700, JUMP_VELOCITY)).takeoff).toBeNull();
    });

    it("is not the launch of a Spring", () => {
      const cues = new MovementCues(FALL_Y);
      cues.update("a", frame(0));
      expect(cues.update("a", frame(16, { launchPadEpoch: 1 })).launched).toBe(true);
      expect(cues.update("a", air(50, 18, { launchPadEpoch: 1 })).takeoff).toBeNull();
    });

    it("is never heard for a Character first seen in the air", () => {
      const cues = new MovementCues(FALL_Y);
      expect(cues.update("a", air(0, JUMP_VELOCITY)).takeoff).toBeNull();
      expect(cues.update("a", air(16, JUMP_VELOCITY)).takeoff).toBeNull();
    });
  });

  describe("landing", () => {
    it("comes after enough air, with the fall's peak speed", () => {
      const cues = new MovementCues(FALL_Y);
      cues.update("a", frame(0));
      cues.update("a", air(16, JUMP_VELOCITY));
      cues.update("a", air(400, -15));
      expect(cues.update("a", frame(500, { vy: -2 })).landing).toEqual({ fallSpeed: 15 });
      expect(cues.update("a", frame(516)).landing).toBeNull();
    });

    it("is not a hop shorter than the landing animation's rule", () => {
      const cues = new MovementCues(FALL_Y);
      cues.update("a", frame(0));
      cues.update("a", air(16, -2));
      expect(cues.update("a", frame(16 + LANDING_MIN_AIRBORNE_MS - 1)).landing).toBeNull();
    });

    it("is not getting up from a knockdown, and a Respawn's drop is not the fall before it", () => {
      const cues = new MovementCues(FALL_Y);
      cues.update("a", frame(0));
      cues.update("a", air(16, -10));
      cues.update("a", air(300, -10, { motionState: "Ragdoll" }));
      expect(cues.update("a", frame(900, { motionState: "GettingUp" })).landing).toBeNull();
      expect(cues.update("a", frame(1500)).landing).toBeNull();

      cues.update("a", air(2000, -10));
      cues.update("a", air(2500, -20, { y: -10 }));
      // Put back on the Checkpoint, a little above it: its touchdown is the drop's own, not the fall's.
      cues.update("a", air(2600, 0, { respawnCount: 1, motionState: "Stagger" }));
      cues.update("a", air(2700, -3, { respawnCount: 1, motionState: "Stagger" }));
      expect(cues.update("a", frame(2800, { respawnCount: 1, motionState: "Stagger" })).landing).toEqual({ fallSpeed: 3 });
    });
  });

  describe("Dash", () => {
    it("starts once per burst", () => {
      const cues = new MovementCues(FALL_Y);
      cues.update("a", frame(0));
      expect(cues.update("a", frame(16, { dashing: true })).dashStarted).toBe(true);
      expect(cues.update("a", frame(33, { dashing: true })).dashStarted).toBe(false);
      cues.update("a", frame(1000));
      expect(cues.update("a", frame(16 + DASH_COOLDOWN_MS, { dashing: true })).dashStarted).toBe(true);
    });

    it("is not a replay dropping a burst for a frame and finding it again", () => {
      const cues = new MovementCues(FALL_Y);
      cues.update("a", frame(0));
      cues.update("a", frame(16, { dashing: true }));
      cues.update("a", frame(100));
      expect(cues.update("a", frame(116, { dashing: true })).dashStarted).toBe(false);
      expect(DASH_RESTART_MIN_MS).toBeLessThan(DASH_COOLDOWN_MS);
    });

    it("is not a burst already going when the Character is first seen", () => {
      const cues = new MovementCues(FALL_Y);
      expect(cues.update("a", frame(0, { dashing: true })).dashStarted).toBe(false);
    });
  });

  describe("Spring and Respawn", () => {
    it("fire once per rise, and not for a replay raising the counter a second time", () => {
      const cues = new MovementCues(FALL_Y);
      cues.update("a", frame(0));
      expect(cues.update("a", frame(16, { launchPadEpoch: 1 })).launched).toBe(true);
      expect(cues.update("a", air(100, 18, { launchPadEpoch: 2 })).launched).toBe(false);
      expect(cues.update("a", frame(16 + SPRING_REFIRE_MIN_MS + 500, { launchPadEpoch: 3 })).launched).toBe(true);

      cues.update("a", frame(3000, { launchPadEpoch: 3 }));
      expect(cues.update("a", frame(3016, { launchPadEpoch: 3, respawnCount: 1 })).respawned).toBe(true);
      expect(cues.update("a", frame(3100, { launchPadEpoch: 3, respawnCount: 2 })).respawned).toBe(false);
      expect(
        cues.update("a", frame(3016 + RESPAWN_REFIRE_MIN_MS + 1500, { launchPadEpoch: 3, respawnCount: 3 })).respawned,
      ).toBe(true);
    });

    it("start over, silently, when a fresh Round's simulation restarts the counters", () => {
      const cues = new MovementCues(FALL_Y);
      cues.update("a", frame(0, { launchPadEpoch: 5, respawnCount: 4 }));
      const reset = cues.update("a", frame(16));
      expect(reset.launched || reset.respawned).toBe(false);
      expect(cues.update("a", frame(1000, { launchPadEpoch: 1 })).launched).toBe(true);
    });

    it("are heard while knocked down, too", () => {
      const cues = new MovementCues(FALL_Y);
      cues.update("a", frame(0, { motionState: "Ragdoll", grounded: false }));
      expect(cues.update("a", frame(16, { motionState: "Ragdoll", grounded: false, launchPadEpoch: 1 })).launched).toBe(true);
    });
  });

  describe("fall", () => {
    it("whistles once when dropping below the Track, again only after standing or a Respawn", () => {
      const cues = new MovementCues(FALL_Y);
      cues.update("a", frame(0));
      expect(cues.update("a", air(100, -8, { y: FALL_Y + 0.5 })).falling).toBe(false);
      expect(cues.update("a", air(200, -10, { y: FALL_Y - 0.5 })).falling).toBe(true);
      expect(cues.update("a", air(300, -12, { y: FALL_Y - 2 })).falling).toBe(false);

      cues.update("a", air(400, 0, { respawnCount: 1 }));
      expect(cues.update("a", air(1200, -10, { respawnCount: 1, y: FALL_Y - 1 })).falling).toBe(true);
    });

    it("never whistles for rising through that height, or standing below it", () => {
      const cues = new MovementCues(FALL_Y);
      cues.update("a", frame(0, { y: FALL_Y - 5 }));
      expect(cues.update("a", frame(16, { y: FALL_Y - 5 })).falling).toBe(false);
      expect(cues.update("a", air(33, 10, { y: FALL_Y - 4 })).falling).toBe(false);
    });

    it("sits under the Track, and never later than its lead over the kill plane", () => {
      expect(fallWhistleY(-1, -8)).toBe(-1);
      expect(fallWhistleY(-20, -8)).toBe(-8 + FALL_WHISTLE_MIN_LEAD);
      expect(fallWhistleY(Infinity, -8)).toBe(-8 + FALL_WHISTLE_MIN_LEAD);
    });
  });

  it("keeps Characters apart, and forgets one entirely", () => {
    const cues = new MovementCues(FALL_Y);
    cues.update("a", frame(0));
    cues.update("b", air(0, -1));
    expect(cues.update("a", air(16, JUMP_VELOCITY)).takeoff).not.toBeNull();
    expect(cues.update("b", air(16, JUMP_VELOCITY)).takeoff).toBeNull();

    cues.update("a", frame(500, { launchPadEpoch: 2 }));
    cues.forget("a");
    // Seen again: history, not a Spring.
    expect(cues.update("a", frame(600, { launchPadEpoch: 3 })).launched).toBe(false);
  });
});
