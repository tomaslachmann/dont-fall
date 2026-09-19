import type { CSSProperties } from 'react';
import s from './DashMeter.module.css';

export interface DashMeterProps {
  /** How far the recharge has come, 0–1 — already rounded to what is drawn (ADR 0088). */
  charge: number;
  /** Whether the Dash can fire right now. The exact flag, not `charge === 1`. */
  ready: boolean;
  /** Whole seconds until it is back — RECHARGES IN. */
  rechargeS: number;
  /** The Dash's key. */
  dashKey: string;
}

/**
 * The Dash recharge, on both Round HUDs (ADR 0092) — the design's DashFeedback
 * charge card (ADR 0110, the user's pick): DASH CHARGE and its key, one pip for
 * the one Dash, filling as it recharges, and the time until it is back. While
 * the Dash is ready the card blinks — the design's halo, which is the state
 * that changes what the Player does next.
 */
export default function DashMeter({ charge, ready, rechargeS, dashKey }: DashMeterProps) {
  const fill = { '--df-dash-fill': `${Math.round(charge * 100)}%` } as CSSProperties;
  return (
    <div className={[s.charge, ready && s.ready].filter(Boolean).join(' ')}>
      {ready && <span className={s.halo} />}
      <div className={s.chargeCard}>
        <div className={s.chargeHead}>
          <span className={s.chargeLabel}>DASH CHARGE</span>
          <span className={s.chargeKey}>PRESS {dashKey.toUpperCase()}</span>
        </div>
        <div className={s.pips}>
          <span className={[s.pip, ready && s.pipOn].filter(Boolean).join(' ')} style={fill} />
        </div>
        <span className={s.recharge}>{ready ? 'READY' : `RECHARGES IN ${rechargeS}s`}</span>
      </div>
    </div>
  );
}
