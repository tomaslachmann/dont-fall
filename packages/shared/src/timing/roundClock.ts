import { TICK_MS } from "../tuning.js";

/**
 * How much of a Round's Time Limit is left after `ticksElapsed` Ticks
 * (M4 ticket 03, ADR 0038).
 *
 * Derived from the Tick count, never from a wall clock: the Tick is the unit
 * of game time (ADR 0004), so the clock a player watches advances in lockstep
 * with the simulation they are playing rather than drifting against it.
 *
 * The server owns this — the client only renders what the Snapshot carries.
 * That is what stops two players seeing two different clocks, and it is why
 * this takes an elapsed Tick count rather than reading any clock itself.
 *
 * Clamped at both ends. Zero is a floor rather than an end: reaching it does
 * not stop the Round until M4 ticket 05, so the server keeps asking long
 * after the Limit is up.
 */
export const roundTimeLeftMs = (timeLimitMs: number, ticksElapsed: number): number => {
  const left = timeLimitMs - ticksElapsed * TICK_MS;
  return left < 0 ? 0 : left > timeLimitMs ? timeLimitMs : left;
};
