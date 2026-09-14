import Stage from '../ui/Stage';
import Avatar from '../ui/Avatar';
import type { Skin } from '../ui/Avatar';
import Chip from '../ui/Chip';
import s from './SurvivalEndgame.module.css';

export interface SurvivalEndgameProps {
  remaining?: number;
  startedWith?: number;
  /** Who's still in. First entry is you. */
  alive?: Skin[];
  survived?: string;
  lastOut?: string;
  yourPlace?: string;
}

export default function SurvivalEndgame({
  remaining = 4, startedWith = 32, alive = ['pink', 'cyan', 'mint', 'gold'],
  survived = '04:32', lastOut = 'SPLATTO WAS ELIMINATED', yourPlace = 'YOU ARE 2ND',
}: SurvivalEndgameProps) {
  return (
    <Stage
      background="var(--df-stage-tension)"
      field="var(--df-field-dash)"
      className={s.screen}
      overlay={<div className={s.danger} />}
    >
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
            <Avatar key={i} skin={skin} size={3} ring={i === 0 ? 'var(--df-color-accent)' : undefined} />
          ))}
        </div>
      </div>

      <div className={s.critical}>
        <svg viewBox="0 0 18 16" aria-hidden="true"><path d="M9 0l9 16H0z" /></svg>
        CRITICAL ZONE
      </div>

      <p className={s.feed}>GAMEPLAY FEED · FINAL FOUR</p>

      <div className={s.status}>
        <Chip tone="plate" lg>{lastOut}</Chip>
        <Chip tone="any" lg>{yourPlace}</Chip>
      </div>
    </Stage>
  );
}
