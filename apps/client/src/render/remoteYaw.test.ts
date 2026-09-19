import { REMOTE_YAW_SMOOTH_MS, SPIN_MAX_SPEED, TICK_MS, wrapAngle } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { followYaw, RemoteYaws, type YawFollow } from "./remoteYaw.js";

const DEG = Math.PI / 180;
const TURN = 3; // rad/s: an ordinary running turn

/** A facing as the interpolator hands it out: lerped between one value per Tick. */
const interpolated = (perTick: (tick: number) => number) => (ms: number) => {
  const tick = Math.floor(ms / TICK_MS);
  return perTick(tick) + wrapAngle(perTick(tick + 1) - perTick(tick)) * ((ms - tick * TICK_MS) / TICK_MS);
};

/** `yaws` drawing one unpinned Character at `hz` for `ms`, one entry per frame. */
const drive = (yaws: RemoteYaws, facingAt: (ms: number) => number, hz: number, ms: number) => {
  const frames: { ms: number; yaw: number }[] = [];
  for (let frame = 0; frame * (1000 / hz) <= ms; frame += 1) {
    const at = frame * (1000 / hz);
    frames.push({ ms: at, yaw: yaws.draw("them", { facing: facingAt(at), respawnCount: 0, pinned: false, deltaSeconds: 1 / hz }) });
  }
  return frames;
};

/** Each frame's drawn turn rate (rad/s) after the first. */
const ratesOf = (frames: { ms: number; yaw: number }[]) =>
  frames.slice(1).map((f, i) => wrapAngle(f.yaw - frames[i]!.yaw) / ((f.ms - frames[i]!.ms) / 1000));

describe("RemoteYaws (ADR 0109)", () => {
  it("draws a Character's facing exactly on first sight", () => {
    expect(new RemoteYaws().draw("them", { facing: 1.234, respawnCount: 0, pinned: false, deltaSeconds: 1 / 60 })).toBe(1.234);
  });

  it.each([60, 144])("trails a steady turn by about REMOTE_YAW_SMOOTH_MS, at %i Hz", (hz) => {
    const facingAt = interpolated((tick) => (TURN * tick * TICK_MS) / 1000);
    const last = drive(new RemoteYaws(), facingAt, hz, 2000).at(-1)!;
    const lagMs = (wrapAngle(facingAt(last.ms) - last.yaw) / TURN) * 1000;
    // Each frame's facing is held across it, which takes half a frame off.
    expect(lagMs).toBeGreaterThan(REMOTE_YAW_SMOOTH_MS - 1000 / hz);
    expect(lagMs).toBeLessThanOrEqual(REMOTE_YAW_SMOOTH_MS);
  });

  it.each([60, 120, 144])("never stands still through a one-tick hold of the facing, at %i Hz", (hz) => {
    // The server ran Tick 30 on a repeated input: the facing holds for a
    // Tick, then steps two Ticks' worth. Drawn raw, that is a stop and a
    // double-speed lurch.
    const held = 30;
    const facingAt = interpolated((tick) => (TURN * (tick === held ? held - 1 : tick) * TICK_MS) / 1000);
    const rates = ratesOf(drive(new RemoteYaws(), facingAt, hz, 2000).filter((f) => f.ms > 600 && f.ms < 1600));
    expect(Math.min(...rates)).toBeGreaterThan(0.25 * TURN);
    expect(Math.max(...rates)).toBeLessThan(1.6 * TURN);
  });

  it.each([30, 60, 144])("never overshoots a turn that stops, at %i Hz", (hz) => {
    const stopAt = 20;
    const facingAt = interpolated((tick) => (TURN * Math.min(tick, stopAt) * TICK_MS) / 1000);
    const stopped = (TURN * stopAt * TICK_MS) / 1000;
    const frames = drive(new RemoteYaws(), facingAt, hz, 1500);
    expect(Math.max(...frames.map((f) => f.yaw))).toBeLessThanOrEqual(stopped + 1e-9);
    expect(frames.at(-1)!.yaw).toBeCloseTo(stopped, 6);
  });

  it.each([30, 60, 144])("hands a one-frame pin back with the turn it found, not its catch-up, at %i Hz", (hz) => {
    // A hold one frame long (a one-Tick hold on a slow screen) as the turn
    // stops. Its frame closes the follow's lag in one step; measured as a
    // turn, that step left with a made-up rate the follow then overshot the
    // stopped facing on — by 1.5° at 60 Hz and 3.1° at 144.
    const yaws = new RemoteYaws();
    const dt = 1 / hz;
    let frame = 0;
    for (; frame < hz; frame += 1) {
      yaws.draw("them", { facing: TURN * frame * dt, respawnCount: 0, pinned: false, deltaSeconds: dt });
    }
    const stopped = TURN * frame * dt;
    expect(yaws.draw("them", { facing: stopped, respawnCount: 0, pinned: true, deltaSeconds: dt })).toBe(stopped);
    const drawn: number[] = [];
    for (let after = 0; after < hz; after += 1) {
      drawn.push(yaws.draw("them", { facing: stopped, respawnCount: 0, pinned: false, deltaSeconds: dt }));
    }
    // The turn's own rate carried from exactly the facing overshoots a little; never by a degree.
    expect(Math.max(...drawn) - stopped).toBeLessThan(1 * DEG);
    expect(drawn.at(-1)!).toBeCloseTo(stopped, 6);
  });

  it("snaps on a Respawn, however far the facing moved", () => {
    const yaws = new RemoteYaws();
    yaws.draw("them", { facing: 0, respawnCount: 0, pinned: false, deltaSeconds: 1 / 60 });
    expect(yaws.draw("them", { facing: 30 * DEG, respawnCount: 1, pinned: false, deltaSeconds: 1 / 60 })).toBe(30 * DEG);
  });

  it.each([60, 144])(
    "draws a hold exactly through a full Spin, both ends, and lets go of it still turning, at %i Hz",
    (hz) => {
      const yaws = new RemoteYaws();
      const dt = 1 / hz;
      // Both were drawn behind their facings before the hold.
      drive(yaws, (ms) => (TURN * ms) / 1000, hz, 500);
      yaws.draw("held", { facing: 2, respawnCount: 0, pinned: false, deltaSeconds: dt });
      const spinAt = (ms: number) => wrapAngle(1.5 + (SPIN_MAX_SPEED * ms) / 1000);
      const turnMs = (2 * Math.PI * 1000) / SPIN_MAX_SPEED;
      let ms = 0;
      for (; ms <= turnMs; ms += 1000 / hz) {
        expect(yaws.draw("them", { facing: spinAt(ms), respawnCount: 0, pinned: true, deltaSeconds: dt })).toBe(spinAt(ms));
        const heldFacing = wrapAngle(spinAt(ms) + Math.PI);
        expect(yaws.draw("held", { facing: heldFacing, respawnCount: 0, pinned: true, deltaSeconds: dt })).toBe(heldFacing);
      }
      // Let go, the facing turning on: the follow carries the Spin's own rate
      // over. Restarted from rest, a 25 ms follow's first frame would turn at
      // 11% of it at 144 Hz and 38% at 60; carried over, never below
      // 1 − 1/e ≈ 63%, whatever the smoothing time.
      let previous = spinAt(ms - 1000 / hz);
      const rates: number[] = [];
      for (const end = ms + 300; ms <= end; ms += 1000 / hz) {
        const yaw = yaws.draw("them", { facing: spinAt(ms), respawnCount: 0, pinned: false, deltaSeconds: dt });
        rates.push(wrapAngle(yaw - previous) / dt / SPIN_MAX_SPEED);
        previous = yaw;
      }
      expect(rates[0]).toBeGreaterThan(0.6);
      expect(Math.min(...rates)).toBeGreaterThan(0.25);
      expect(Math.max(...rates)).toBeLessThanOrEqual(1 + 1e-9);
      expect(rates.at(-1)).toBeCloseTo(1, 2);
    },
  );

  it.each([40, 170])(
    "keeps the yaw it went down with, then swings %i° to the live facing on the get-up without overshooting",
    (gapDegrees) => {
      const yaws = new RemoteYaws();
      yaws.draw("them", { facing: 0, respawnCount: 0, pinned: false, deltaSeconds: 1 / 60 });
      for (let frame = 0; frame < 60; frame += 1) expect(yaws.rest("them", { facing: frame * DEG, respawnCount: 0 })).toBe(0);
      const up = gapDegrees * DEG;
      const drawn: number[] = [];
      for (let frame = 0; frame < 30; frame += 1) {
        drawn.push(yaws.draw("them", { facing: up, respawnCount: 0, pinned: false, deltaSeconds: 1 / 60 }));
      }
      // A swing, not a snap, however wide.
      expect(drawn[0]).toBeGreaterThan(0);
      expect(drawn[0]).toBeLessThan(up);
      for (let frame = 1; frame < drawn.length; frame += 1) {
        expect(drawn[frame]).toBeGreaterThanOrEqual(drawn[frame - 1]!);
        expect(drawn[frame]).toBeLessThanOrEqual(up);
      }
      // About four smoothing times.
      const settled = drawn.findIndex((yaw) => up - yaw < 1 * DEG);
      expect(settled).toBeGreaterThan(0);
      expect((settled + 1) / 60).toBeLessThan((5 * REMOTE_YAW_SMOOTH_MS) / 1000);
    },
  );

  it("draws a Character first seen down at the facing it is shown with", () => {
    expect(new RemoteYaws().rest("them", { facing: 1.1, respawnCount: 0 })).toBe(1.1);
  });

  it("forgets a Character that left, so one that comes back snaps", () => {
    const yaws = new RemoteYaws();
    yaws.draw("them", { facing: 0, respawnCount: 0, pinned: false, deltaSeconds: 1 / 60 });
    yaws.forget("them");
    expect(yaws.draw("them", { facing: 1, respawnCount: 0, pinned: false, deltaSeconds: 1 / 60 })).toBe(1);
  });

  it("is frame-rate independent: a swing lands within 1° at 30, 60, 144 and 240 Hz, and on uneven frames", () => {
    const smooth = REMOTE_YAW_SMOOTH_MS / 1000;
    /** A 90° swing from rest through frames of `frameMs`, the last cut short to land on one and two smoothing times. */
    const swing = (frameMs: (frame: number) => number) =>
      [REMOTE_YAW_SMOOTH_MS, 2 * REMOTE_YAW_SMOOTH_MS].map((untilMs) => {
        let state: YawFollow = { yaw: 0, rate: 0 };
        let ms = 0;
        for (let frame = 0; ms < untilMs; frame += 1) {
          const step = Math.min(frameMs(frame), untilMs - ms);
          state = followYaw(state, 90 * DEG, step / 1000, smooth);
          ms += step;
        }
        return state.yaw;
      });
    const runs = [30, 60, 144, 240].map((hz) => swing(() => 1000 / hz));
    runs.push(swing((frame) => 4 + ((frame * 7919) % 29))); // 4–32 ms, no pattern
    for (const instant of [0, 1]) {
      const yaws = runs.map((run) => run[instant]!);
      // Still mid-swing, where a stepped integrator would disagree.
      expect(Math.min(...yaws)).toBeLessThan(85 * DEG);
      expect(Math.max(...yaws) - Math.min(...yaws)).toBeLessThan(1 * DEG);
    }
  });
});
