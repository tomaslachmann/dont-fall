/**
 * The Round timer as the HUD shows it — `m:ss` (M4 ticket 03).
 *
 * Purely a rendering of `SnapshotMessage.timeLeftMs`: the server owns the
 * clock and counts it down from its own Tick (ADR 0038), so this never reads
 * a clock of its own. That is what keeps two players' timers identical rather
 * than drifting apart by their own wall clocks.
 *
 * Rounds up, so a Round displays its full authored Limit until a whole second
 * has actually gone (a timer that read 2:59 the instant it started would look
 * broken), and reaches `0:00` only when the clock is genuinely out.
 */
export const formatRoundClock = (timeLeftMs: number): string => {
  const totalSeconds = Math.ceil(Math.max(0, timeLeftMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

/**
 * A finished run's own time, `mm:ss.mmm` (ticket 14) — the verdict's TIME
 * plate. Floored, never ceiled: this measures what already happened, so
 * rounding up would credit milliseconds never run.
 */
export const formatRaceTime = (elapsedMs: number): string => {
  const clamped = Math.max(0, Math.floor(elapsedMs));
  const minutes = Math.floor(clamped / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1000);
  const millis = clamped % 1000;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${millis.toString().padStart(3, "0")}`;
};

/**
 * How long a run lasted, `m:ss` (ticket 14) — the verdict's SURVIVED plate.
 * Floored like the race time above: whole seconds survived, nothing gifted.
 */
export const formatSurvived = (elapsedMs: number): string => {
  const totalSeconds = Math.floor(Math.max(0, elapsedMs) / 1000);
  return `${Math.floor(totalSeconds / 60)}:${(totalSeconds % 60).toString().padStart(2, "0")}`;
};
