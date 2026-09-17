import Stage from '../ui/Stage';
import Avatar from '../ui/Avatar';
import type { Skin } from '../ui/Avatar';
import Chip from '../ui/Chip';
import type { Feel } from '../tokens';
import s from './SurvivalHud.module.css';

export interface SurvivalHudProps {
  remaining: number;
  startedWith: number;
  /** Who's still in — you first, ringed, while you are. */
  alive: Skin[];
  /** Whether the first entry of `alive` is you. */
  youAlive: boolean;
  /** m:ss */
  survived: string;
  /** "SPLATTO WAS ELIMINATED"; `null` before anyone was. */
  lastOut: string | null;
  /** Survivors one Fall from the Survivor Target, or the clock running low. */
  critical: boolean;
  feel?: Feel;
}

/**
 * 1d — the Survival HUD, live over the running Round (ADR 0088). Everything on
 * it is a count: how many are left, how long the Round has run, who just went.
 * No placement — how many are left is Survival's measure. No Stage background:
 * the game shows through.
 */
export default function SurvivalHud({ remaining, startedWith, alive, youAlive, survived, lastOut, critical, feel }: SurvivalHudProps) {
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
          {alive.map((skin, i) => (
            <Avatar key={i} skin={skin} size={3} ring={youAlive && i === 0 ? 'var(--df-color-accent)' : undefined} />
          ))}
        </div>
      </div>

      {critical && (
        <div className={s.critical}>
          <svg viewBox="0 0 18 16" aria-hidden="true"><path d="M9 0l9 16H0z" /></svg>
          CRITICAL ZONE
        </div>
      )}

      {lastOut !== null && (
        <div className={s.status}>
          <Chip tone="plate" lg>{lastOut}</Chip>
        </div>
      )}
    </Stage>
  );
}
