import type { CSSProperties } from 'react';
import Stage from '../ui/Stage';
import JellyButton from '../ui/JellyButton';
import { Pips } from '../ui/Meter';
import type { Feel } from '../tokens';
import s from './FinishedOrOut.module.css';

export interface RunStat {
  label: string;
  value: string;
  /** The points plate — yellow. */
  accent?: boolean;
  /** Value reads as a loss (off your PB). */
  warn?: boolean;
}

export interface Outcome {
  badge: string;
  /** The big number: "3RD" or "#7". */
  result: string;
  stats: RunStat[];
  out?: boolean;
}

export interface FinishedOrOutProps {
  /** Both beats play in sequence, as in the mock. Pass one to show a single outcome. */
  outcomes?: Outcome[];
  position?: number;
  field?: number;
  checkpoints?: number;
  personalBest?: string;
  nextRoundIn?: string;
  onSpectate?: () => void;
  feel?: Feel;
}

const OUTCOMES: Outcome[] = [
  {
    badge: 'FINISHED',
    result: '3RD',
    stats: [
      { label: 'TIME', value: '01:22.104' },
      { label: 'POINTS', value: '+120', accent: true },
      { label: 'OFF YOUR PB', value: '+2.2', warn: true },
    ],
  },
  {
    badge: 'KNOCKED OUT',
    result: '#7',
    out: true,
    stats: [
      { label: 'SURVIVED', value: '04:32' },
      { label: 'POINTS', value: '+60', accent: true },
      { label: 'GRABBED BY', value: 'FLOPPO' },
    ],
  },
];

export default function FinishedOrOut({
  outcomes = OUTCOMES, position = 3, field = 16, checkpoints = 7,
  personalBest = 'PB 01:19.904', nextRoundIn = '0:09', onSpectate, feel,
}: FinishedOrOutProps) {
  return (
    <Stage
      background="var(--df-stage-race)"
      field="var(--df-field-race)"
      sheen="var(--df-sheen-lift)"
      feel={feel}
      className={s.screen}
      overlay={
        <div className={s.verdict}>
          {outcomes.map((o, i) => (
            <div key={o.badge} className={[s.flash, o.out && s.flashOut].filter(Boolean).join(' ')} style={{ animationDelay: `${i * 3}s` }} />
          ))}
          {outcomes.map((o, i) => (
            <div key={o.badge} className={s.beat} style={{ '--df-beat-delay': `${i * 3}s` } as CSSProperties}>
              <span className={[s.badge, o.out ? s.badgeOut : s.badgeFinished].join(' ')}>{o.badge}</span>
              <span className={s.result}>{o.result}</span>
              <span className={s.plates}>
                {o.stats.map((st) => (
                  <span key={st.label} className={[s.plate, st.accent && s.plateAccent].filter(Boolean).join(' ')}>
                    <span className={s.plateLabel}>{st.label}</span>
                    <span className={[s.plateValue, st.warn && s.plateWarn].filter(Boolean).join(' ')} data-df-numeric>{st.value}</span>
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      }
    >
      <div className={[s.position, s.hud].join(' ')}>
        <span className={s.place} data-df-numeric>{String(position).padStart(2, '0')}</span>
        <span className={s.positionMeta}>
          <span className={s.field}>/{field}</span>
          <span className={s.caption}>POSITION</span>
        </span>
      </div>

      <span />

      <div className={[s.checkpoints, s.hud].join(' ')}>
        <span className={s.cpLabel}>CHECKPOINT {String(checkpoints).padStart(2, '0')} / {String(checkpoints).padStart(2, '0')}</span>
        <Pips total={checkpoints} done={checkpoints} />
        <span className={s.pb}>{personalBest}</span>
      </div>

      <p className={s.feed}>GAMEPLAY FEED · RUN ENDING</p>

      <div className={s.actions}>
        <JellyButton variant="tile" centered feel={feel} onClick={onSpectate}>SPECTATE</JellyButton>
        <JellyButton variant="pill" tone="glass" centered feel={feel}>SCOREBOARD</JellyButton>
        <JellyButton variant="pill" tone="glass" centered feel={feel}>LEAVE</JellyButton>
        <span className={s.timer}>NEXT ROUND IN {nextRoundIn}</span>
      </div>
    </Stage>
  );
}
