import type { ReactNode } from 'react';
import Stage from '../ui/Stage';
import Avatar from '../ui/Avatar';
import Pill from '../ui/Pill';
import { Pips } from '../ui/Meter';
import type { Feel } from '../tokens';
import s from './RaceHUD.module.css';

export interface RaceHUDProps {
  position?: number;
  field?: number;
  /** mm:ss */
  time?: string;
  /** Milliseconds tail, rendered smaller. */
  ms?: string;
  /** Signed gap to the leader, e.g. "+2.478". */
  delta?: string;
  checkpoint?: number;
  checkpoints?: number;
  personalBest?: string;
  /** Threat callout along the bottom; falsy hides it. */
  threat?: string | null;
  /** Feedback beats and takeovers, stacked above the HUD. */
  overlay?: ReactNode;
  feel?: Feel;
}

export default function RaceHUD({
  position = 3, field = 16, time = '01:24', ms = '.382', delta = '+2.478',
  checkpoint = 4, checkpoints = 7, personalBest = 'PB 01:19.904',
  threat = 'FLOPPO IS RIGHT BEHIND YOU', overlay, feel,
}: RaceHUDProps) {
  return (
    <Stage
      background="var(--df-stage-race)"
      field="var(--df-field-race)"
      sheen="var(--df-sheen-lift)"
      feel={feel}
      className={s.screen}
      overlay={overlay}
    >
      <div className={s.position}>
        <span className={s.place} data-df-numeric>{String(position).padStart(2, '0')}</span>
        <span className={s.positionMeta}>
          <span className={s.field}>/{field}</span>
          <span className={s.caption}>POSITION</span>
        </span>
      </div>

      <div className={s.clock}>
        <span className={s.time} data-df-numeric>{time}<span className={s.ms}>{ms}</span></span>
        <Pill tone="danger">
          <svg viewBox="0 0 8 8" aria-hidden="true"><path d="M4 8L0 1h8z" /></svg>
          <span data-df-numeric>{delta}</span>
        </Pill>
      </div>

      <div className={s.checkpoints}>
        <span className={s.cpLabel}>
          CHECKPOINT {String(checkpoint).padStart(2, '0')} / {String(checkpoints).padStart(2, '0')}
        </span>
        <Pips total={checkpoints} done={checkpoint} />
        <span className={s.pb}>{personalBest}</span>
      </div>

      <p className={s.feed}>GAMEPLAY FEED<br />EXISTING CHARACTER-DRIVEN GAME</p>

      {threat && (
        <div className={s.threat}>
          <Avatar skin="cyan" size={2.65} />
          <span>{threat}</span>
          <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 14L0 4h14z" /></svg>
        </div>
      )}
    </Stage>
  );
}
