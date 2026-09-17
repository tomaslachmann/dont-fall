import {
  DurationHistogram,
  TICK_MS,
  emptySimulationTimings,
  type DurationSummary,
  type MatchPhase,
  type SimulationTimings,
} from "@dont-fall/shared";

/**
 * The Match server's own tick timing (M13 ticket 02). Off unless the process
 * runs with `DONTFALL_PERF=1`; then the Match loop reports every tick here and
 * one line per {@link TICK_PERF_REPORT_MS} goes to the log while a Round is
 * live. Measurement only — nothing reads it back.
 */

/** How often a live Match logs its timing line. */
export const TICK_PERF_REPORT_MS = 10_000;

/** The `perf_hooks` event-loop-delay histogram, as far as this reads it (nanoseconds). */
export interface EventLoopDelaySource {
  percentile: (percentile: number) => number;
  readonly max: number;
  readonly count: number;
  reset: () => void;
}

/** One logged window. */
export interface TickPerfReport {
  /** Wall time the window covered. */
  windowMs: number;
  clients: number;
  /** Whole-tick duration: phase, input, the shared step, the snapshot and every send. */
  tick: DurationSummary;
  /** Serialising and sending every client's snapshot message, per tick that sent one. */
  send: DurationSummary;
  /** Means over the window's ticks, from a simulation built with a `profileClock`. */
  physics: SimulationTimings | null;
  /** Delay beyond the monitor's own resolution, in ms — `null` without a monitor. */
  eventLoopDelay: { p50Ms: number; p99Ms: number; maxMs: number } | null;
}

/** The phases whose ticks step the world — a quiet Lobby would only dilute the numbers. */
const measuredPhase = (phase: MatchPhase): boolean => phase === "COUNTDOWN" || phase === "RUNNING";

const PHYSICS_KEYS = Object.keys(emptySimulationTimings()) as (keyof SimulationTimings)[];

export interface TickPerfOptions {
  /** A millisecond clock — `performance.now` in the server. */
  now: () => number;
  log: (line: string) => void;
  eventLoop?: EventLoopDelaySource | null;
  /** The event-loop monitor's resolution in ms, subtracted from what it reports. */
  eventLoopResolutionMs?: number;
  reportEveryMs?: number;
}

export class TickPerf {
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly eventLoop: EventLoopDelaySource | null;
  private readonly eventLoopResolutionMs: number;
  private readonly reportEveryMs: number;
  private readonly tick = new DurationHistogram({ binMs: 0.05, rangeMs: 200, thresholdsMs: [TICK_MS] });
  private readonly send = new DurationHistogram({ binMs: 0.05, rangeMs: 200 });
  private physicsSums = emptySimulationTimings();
  private physicsTicks = 0;
  private clients = 0;
  private windowStartedAt: number;

  constructor({ now, log, eventLoop = null, eventLoopResolutionMs = 0, reportEveryMs = TICK_PERF_REPORT_MS }: TickPerfOptions) {
    this.now = now;
    this.log = log;
    this.eventLoop = eventLoop;
    this.eventLoopResolutionMs = eventLoopResolutionMs;
    this.reportEveryMs = reportEveryMs;
    this.windowStartedAt = now();
  }

  /** Serialising and sending the snapshots, for one tick that sent — counted, like ticks, only in a phase that steps the world. */
  recordSend(durationMs: number, phase: MatchPhase): void {
    if (measuredPhase(phase)) this.send.record(durationMs);
  }

  /**
   * One finished tick. Counted only when its phase steps the world; logs and
   * starts a new window once the current one is old enough and has anything in it.
   */
  recordTick(durationMs: number, phase: MatchPhase, clients: number, physics: SimulationTimings | null): void {
    if (measuredPhase(phase)) {
      this.tick.record(durationMs);
      this.clients = Math.max(this.clients, clients);
      if (physics) {
        this.physicsTicks += 1;
        for (const key of PHYSICS_KEYS) this.physicsSums[key] += physics[key];
      }
    }
    const now = this.now();
    if (now - this.windowStartedAt < this.reportEveryMs) return;
    if (this.tick.count > 0) this.log(formatTickPerfLine(this.report(now)));
    this.resetWindow(now);
  }

  private report(now: number): TickPerfReport {
    let physics: SimulationTimings | null = null;
    if (this.physicsTicks > 0) {
      physics = emptySimulationTimings();
      for (const key of PHYSICS_KEYS) physics[key] = this.physicsSums[key] / this.physicsTicks;
    }
    const beyondResolution = (ns: number): number => Math.max(0, ns / 1e6 - this.eventLoopResolutionMs);
    const loop = this.eventLoop;
    return {
      windowMs: now - this.windowStartedAt,
      clients: this.clients,
      tick: this.tick.summary(),
      send: this.send.summary(),
      physics,
      eventLoopDelay:
        loop === null || loop.count === 0
          ? null
          : {
              p50Ms: beyondResolution(loop.percentile(50)),
              p99Ms: beyondResolution(loop.percentile(99)),
              maxMs: beyondResolution(loop.max),
            },
    };
  }

  private resetWindow(now: number): void {
    this.tick.reset();
    this.send.reset();
    this.physicsSums = emptySimulationTimings();
    this.physicsTicks = 0;
    this.clients = 0;
    this.eventLoop?.reset();
    this.windowStartedAt = now;
  }
}

const ms = (value: number): string => value.toFixed(2);

/** One log line — greppable by its prefix, every number in milliseconds. */
export const formatTickPerfLine = (report: TickPerfReport): string => {
  const { tick, send, physics, eventLoopDelay } = report;
  const parts = [
    `${tick.count} ticks in ${(report.windowMs / 1000).toFixed(0)} s`,
    `${report.clients} clients`,
    `tick p50 ${ms(tick.p50Ms)} p99 ${ms(tick.p99Ms)} max ${ms(tick.maxMs)} (${tick.over[0]} over ${TICK_MS.toFixed(1)})`,
    `send p50 ${ms(send.p50Ms)} p99 ${ms(send.p99Ms)}`,
  ];
  if (physics) {
    parts.push(
      `mean step ${ms(physics.stepMs)} (collision ${ms(physics.collisionDetectionMs)}, solver ${ms(physics.solverMs)}, user changes ${ms(physics.userChangesMs)})` +
        ` · sweeps ${ms(physics.characterSweepsMs)} · updates ${ms(physics.characterUpdatesMs)} · moving segments ${ms(physics.movingSegmentsMs)}`,
    );
  }
  if (eventLoopDelay) {
    parts.push(`event loop delay p50 ${ms(eventLoopDelay.p50Ms)} p99 ${ms(eventLoopDelay.p99Ms)} max ${ms(eventLoopDelay.maxMs)}`);
  }
  return `DON'T FALL perf · ${parts.join(" · ")}`;
};

/** Whether this process asked for tick timing. */
export const tickPerfRequested = (env: Record<string, string | undefined>): boolean => env.DONTFALL_PERF === "1";
