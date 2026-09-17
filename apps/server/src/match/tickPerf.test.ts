import { emptySimulationTimings } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { TickPerf, formatTickPerfLine, tickPerfRequested, type EventLoopDelaySource } from "./tickPerf.js";

const fakeClock = () => {
  const clock = { nowMs: 0, now: () => clock.nowMs };
  return clock;
};

describe("TickPerf (M13 ticket 02)", () => {
  it("is on only when the process asks for it", () => {
    expect(tickPerfRequested({ DONTFALL_PERF: "1" })).toBe(true);
    expect(tickPerfRequested({})).toBe(false);
    expect(tickPerfRequested({ DONTFALL_PERF: "0" })).toBe(false);
  });

  it("logs one line per window, then starts a fresh one", () => {
    const clock = fakeClock();
    const lines: string[] = [];
    const perf = new TickPerf({ now: clock.now, log: (line) => lines.push(line), reportEveryMs: 1000 });
    for (const ms of [1, 2, 3]) perf.recordTick(ms, "RUNNING", 2, null);
    expect(lines).toEqual([]);

    clock.nowMs = 1000;
    perf.recordTick(40, "RUNNING", 3, null);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("DON'T FALL perf");
    expect(lines[0]).toContain("4 ticks in 1 s");
    expect(lines[0]).toContain("3 clients");
    expect(lines[0]).toContain("max 40.00 (1 over 33.3)");

    clock.nowMs = 2000;
    perf.recordTick(1, "RUNNING", 1, null);
    expect(lines[1]).toContain("1 ticks in 1 s");
    expect(lines[1]).toContain("(0 over 33.3)");
  });

  it("measures only the phases that step the world, and stays silent in a quiet Lobby", () => {
    const clock = fakeClock();
    const lines: string[] = [];
    const perf = new TickPerf({ now: clock.now, log: (line) => lines.push(line), reportEveryMs: 1000 });
    perf.recordTick(9, "LOBBY", 4, null);
    perf.recordSend(9, "LOBBY");
    clock.nowMs = 1000;
    perf.recordTick(9, "RESULTS", 4, null);
    expect(lines).toEqual([]);

    perf.recordTick(2, "COUNTDOWN", 4, null);
    perf.recordSend(0.5, "COUNTDOWN");
    clock.nowMs = 2000;
    perf.recordTick(9, "LOBBY", 4, null);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("1 ticks in 1 s");
    expect(lines[0]).toContain("send p50 0.50");
  });

  it("averages the simulation's own timings over the window", () => {
    const clock = fakeClock();
    const lines: string[] = [];
    const perf = new TickPerf({ now: clock.now, log: (line) => lines.push(line), reportEveryMs: 1000 });
    perf.recordTick(1, "RUNNING", 1, { ...emptySimulationTimings(), stepMs: 0.2, characterSweepsMs: 0.1 });
    clock.nowMs = 1000;
    perf.recordTick(1, "RUNNING", 1, { ...emptySimulationTimings(), stepMs: 0.4, characterSweepsMs: 0.3 });
    expect(lines[0]).toContain("mean step 0.30");
    expect(lines[0]).toContain("sweeps 0.20");
  });

  it("reports event-loop delay beyond the monitor's resolution, and resets the monitor per window", () => {
    const clock = fakeClock();
    const lines: string[] = [];
    let resets = 0;
    const eventLoop: EventLoopDelaySource = {
      percentile: (p) => (p === 50 ? 11e6 : 14e6),
      max: 30e6,
      count: 10,
      reset: () => {
        resets += 1;
      },
    };
    const perf = new TickPerf({ now: clock.now, log: (line) => lines.push(line), eventLoop, eventLoopResolutionMs: 10, reportEveryMs: 1000 });
    perf.recordTick(1, "RUNNING", 1, null);
    clock.nowMs = 1000;
    perf.recordTick(1, "RUNNING", 1, null);
    expect(lines[0]).toContain("event loop delay p50 1.00 p99 4.00 max 20.00");
    expect(resets).toBe(1);
  });

  it("formats a window without physics or a monitor", () => {
    const line = formatTickPerfLine({
      windowMs: 10_000,
      clients: 12,
      tick: { count: 300, meanMs: 1, p50Ms: 0.9, p95Ms: 2, p99Ms: 3, maxMs: 5, over: [0] },
      send: { count: 300, meanMs: 0.4, p50Ms: 0.35, p95Ms: 0.6, p99Ms: 0.8, maxMs: 1, over: [] },
      physics: null,
      eventLoopDelay: null,
    });
    expect(line).toBe(
      "DON'T FALL perf · 300 ticks in 10 s · 12 clients · tick p50 0.90 p99 3.00 max 5.00 (0 over 33.3) · send p50 0.35 p99 0.80",
    );
  });
});
