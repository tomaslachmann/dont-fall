import { DASH_COOLDOWN_MS, type CharacterMotionState, type MatchPhase, type Vec3 } from "@dont-fall/shared";

/** Everything the HUD's main text block reads — all of it already computed by the frame loop (M4.5 ticket 06). */
export interface HudTextValues {
  roundClock: string;
  phase: MatchPhase;
  tickRateHz: number;
  fps: number;
  predictionTick: number;
  position: Vec3;
  motionState: CharacterMotionState;
  /** Index of the last Checkpoint reached, or `null` for the spawn point. */
  checkpointIndex: number | null;
  fallCount: number;
  qualifiedCount: number;
  connectedPlayers: number;
  qualified: boolean;
  /** 1-based placement among everyone Qualified, or `null` before the server has filled it in. */
  placement: number | null;
  dashCooldownMs: number;
  /** `NetMetrics.format()`'s own output — this function only places it. */
  netMetricsText: string;
}

/**
 * The HUD's main text block (M4.5 ticket 06) — a pure function of the values
 * it renders, extracted from the frame loop so ticket 02's predict/reconcile
 * extraction doesn't also have to carry ~50 lines of string building that has
 * no netcode meaning of its own. Byte-identical to what the frame loop built
 * inline; ADR 0008 still holds — the HUD stays plain DOM, drawn by the game.
 */
export const formatHudText = (v: HudTextValues): string => {
  const checkpoint = v.checkpointIndex === null ? "spawn" : `#${v.checkpointIndex + 1}`;
  const qualificationBanner = v.qualified ? `\n${v.placement === null ? "QUALIFIED" : `QUALIFIED #${v.placement}`}` : "";
  const dashFill = Math.max(0, Math.min(10, Math.round((1 - v.dashCooldownMs / DASH_COOLDOWN_MS) * 10)));
  const dashBar = "#".repeat(dashFill) + "-".repeat(10 - dashFill);

  return (
    `DON'T FALL — M2 · predicted + reconciled\n` +
    `time ${v.roundClock} · ${v.phase.toLowerCase()}\n` +
    `sim ${v.tickRateHz} Hz · render ${v.fps.toFixed(0)} fps · tick ${v.predictionTick}\n` +
    `pos ${v.position.x.toFixed(1)}, ${v.position.y.toFixed(1)}, ${v.position.z.toFixed(1)} · ${v.motionState}\n` +
    `checkpoint ${checkpoint} · falls ${v.fallCount} · qualified ${v.qualifiedCount}/${v.connectedPlayers}${qualificationBanner}\n` +
    `dash [${dashBar}]${v.dashCooldownMs === 0 ? " ready" : ""}\n` +
    `WASD move · Space jump · Shift dash · mouse look\n` +
    v.netMetricsText
  );
};
