import { TICK_MS } from "@dont-fall/shared";

/**
 * How long each Character stayed in a Survival Round, in ms (ADR 0110) — the
 * career's BEST SURVIVAL, one Round's worth. From the Tick the Round started to
 * the Tick it was eliminated, or to the Round's end for whoever was still in
 * it. Pure, so the arithmetic is pinned without a loop.
 */
export const survivalTimesMs = (
  characters: Record<string, { eliminatedTick: number | null }>,
  roundStartTick: number,
  roundEndTick: number,
): Record<string, number> =>
  Object.fromEntries(
    Object.entries(characters).map(([id, character]) => {
      const outTick = Math.min(character.eliminatedTick ?? roundEndTick, roundEndTick);
      return [id, Math.max(0, Math.round((outTick - roundStartTick) * TICK_MS))];
    }),
  );
