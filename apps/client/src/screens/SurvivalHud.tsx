import Stage from '../ui/Stage';
import Avatar from '../ui/Avatar';
import type { AvatarLook } from '../lib/avatar.js';
import Chip from '../ui/Chip';
import DashMeter from './DashMeter';
import type { Feel } from '../tokens';
import s from './SurvivalHud.module.css';

export interface SurvivalHudProps {
  remaining: number;
  startedWith: number;
  /** Who's still in — you first, ringed, while you are. */
  alive: AvatarLook[];
  /** Whether the first entry of `alive` is you. */
  youAlive: boolean;
  /** m:ss */
  survived: string;
  /** "SPLATTO WAS ELIMINATED"; `null` before anyone was. */
  lastOut: string | null;
  /** Survivors one Fall from the Survivor Target, or the clock running low. */
  critical: boolean;
  /** Dash recharge, 0–1 (ADR 0092). */
  dashCharge: number;
  /** Whether the Dash can fire right now. */
  dashReady: boolean;
  /** Whole seconds until the Dash is back, and its key — the charge card (ADR 0110). */
  dashRechargeS: number;
  dashKey: string;
  feel?: Feel;
}

/**
 * 1d — the Survival HUD, live over the running Round (ADR 0088). Everything on
 * it is a count: how many are left, how long the Round has run, who just went.
 * No placement — how many are left is Survival's measure. No Stage background:
 * the game shows through.
 */
export default function SurvivalHud({
  remaining, startedWith, alive, youAlive, survived, lastOut, critical, dashCharge, dashReady, dashRechargeS, dashKey, feel,
}: SurvivalHudProps) {
  return (
    <Stage feel={feel} className={s.screen} overlay={critical ? <div className={s.danger} /> : undefined}>
      <div className={s.survived}>
        <span className={s.survivedLabel}>SURVIVED</span>
        <span className={s.survivedValue} data-df-numeric>{survived}</span>
      </div>

      <div className={s.remaining}>
        <div className={s.countCard}>
          <span className={s.countValue} data-df-numeric>{String(remaining).padStart(2, '0')}</span>
          <span className={s.countText}>
            <span className={s.countLabel}>BEANS LEFT</span>
            <span className={s.countStart}>STARTED WITH {startedWith}</span>
          </span>
        </div>
        <div className={s.alive}>
          {alive.map((look, i) => (
            <Avatar key={i} look={look} size={3} ring={youAlive && i === 0 ? 'var(--df-color-accent)' : undefined} />
          ))}
        </div>
      </div>

      {critical && (
        <div className={s.critical}>
          <svg viewBox="0 0 18 16" aria-hidden="true"><path d="M9 0l9 16H0z" /></svg>
          CRITICAL ZONE
        </div>
      )}

      <div className={s.dash}>
        <DashMeter charge={dashCharge} ready={dashReady} rechargeS={dashRechargeS} dashKey={dashKey} />
      </div>

      {lastOut !== null && (
        <div className={s.status}>
          <Chip tone="plate" lg>{lastOut}</Chip>
        </div>
      )}
    </Stage>
  );
}
