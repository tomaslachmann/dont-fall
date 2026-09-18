import Stage from '../ui/Stage';
import type { HeldPhase } from '@dont-fall/shared';
import s from './HoldingPanel.module.css';

/** How many pips the Spin's wind-up is shown in — the design's charge card, as `DashFeedback` draws it. */
export const WINDUP_PIPS = 6;

export interface HoldingPanelProps {
  /** Who you have. */
  holding: string;
  /** Their Struggle, or Limp. */
  phase: HeldPhase;
  /** How close they are to getting free, 0-100. */
  escape: number;
  /** Time left in the current window, already formatted ("1.4s"). */
  timeLeft: string;
  /** How far your Spin has wound up, 0–1; 0 while not Spinning. */
  windup: number;
  /** How far past full speed you have held it, 0–1 — at 1 you are dizzy. */
  overspin: number;
  /** Hit's key (hold to Spin, let go to Hurl) and Grab's (let go), as bound. */
  spinKey: string;
  letGoKey: string;
}

/**
 * Holding someone (ADR 0104). The design has no screen for this end of a
 * hold, so it is assembled from pieces the design already has, class for
 * class:
 *
 * - `Ragdoll`'s get-up block: its header, its bar, its row of a key and a
 *   timer — here whom you have, how close they are to getting free, and how
 *   long is left;
 * - `Spectator`'s key pills (`keyCap` + `keyLabel`) for what F and G do;
 * - `DashFeedback`'s charge card, pips and halo, for the Spin's wind-up —
 *   shown while you Spin, pulsing once it is full.
 *
 * No Stage background: it floats over the live Round (ADR 0060), at the
 * bottom, so it does not hide where you are carrying them.
 */
export default function HoldingPanel({ holding, phase, escape, timeLeft, windup, overspin, spinKey, letGoKey }: HoldingPanelProps) {
  const spinning = windup > 0;
  const full = windup >= 1;
  const lit = Math.round(windup * WINDUP_PIPS);
  return (
    <Stage className={s.screen}>
      {spinning && (
        <div className={s.charge}>
          {full && <span className={s.halo} />}
          <div className={s.chargeCard}>
            <div className={s.chargeHead}>
              <span className={s.chargeLabel}>SPIN</span>
              <span className={s.chargeKey}>{full ? `RELEASE ${spinKey}` : `HOLD ${spinKey}`}</span>
            </div>
            <div className={s.pips}>
              {Array.from({ length: WINDUP_PIPS }, (_, i) => (
                <span key={i} className={[s.pip, i < lit && s.pipOn].filter(Boolean).join(' ')} />
              ))}
            </div>
            {overspin > 0 && <span className={s.recharge}>DIZZY {Math.round(overspin * 100)}%</span>}
          </div>
        </div>
      )}

      <div className={s.getUp}>
        <div className={s.getUpHead}>
          <span>YOU HAVE {holding}</span>
          <span className={s.mash}>{phase === 'limp' ? 'KNOCKED OUT' : 'BREAKING FREE'}</span>
        </div>
        {phase === 'struggle' && (
          <div className={s.track}>
            <div className={s.fill} style={{ width: `${Math.max(0, Math.min(100, escape))}%` }} />
          </div>
        )}
        <div className={s.keys}>
          <span className={s.key}>
            <span className={s.keyCap}>{spinKey}</span>
            <span className={s.keyLabel}>HOLD SPIN · RELEASE HURL</span>
          </span>
          <span className={s.key}>
            <span className={s.keyCap}>{letGoKey}</span>
            <span className={s.keyLabel}>LET GO</span>
          </span>
          <span className={s.timer}>{timeLeft}</span>
        </div>
      </div>
    </Stage>
  );
}
