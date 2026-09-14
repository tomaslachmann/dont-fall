import type { CSSProperties } from 'react';
import Stage from '../ui/Stage';
import Avatar from '../ui/Avatar';
import type { Skin } from '../ui/Avatar';
import Chip from '../ui/Chip';
import { Pips } from '../ui/Meter';
import s from './Countdown.module.css';

export interface CountdownProps {
  gridSpot?: number;
  field?: number;
  checkpoints?: number;
  personalBest?: string;
  round?: number;
  rounds?: number;
  track?: string;
  mode?: string;
  /** Beans visible on the start line; the rest roll up into a +N bubble. */
  onTheLine?: Skin[];
  othersOnTheLine?: number;
}

/** One beat per second: 3, 2, 1, GO!. */
const BEATS = ['3', '2', '1', 'GO!'];

const delay = (n: number) => ({ '--df-fx-delay': `${n}s` } as CSSProperties);

export default function Countdown({
  gridSpot = 8, field = 16, checkpoints = 7, personalBest = 'PB 01:19.904',
  round = 3, rounds = 3, track = 'THE BIG WOBBLE', mode = 'RACE',
  onTheLine = ['pink', 'cyan', 'mint', 'gold', 'grape'], othersOnTheLine = 11,
}: CountdownProps) {
  return (
    <Stage
      background="var(--df-stage-race)"
      field="var(--df-field-race)"
      sheen="radial-gradient(90% 75% at 50% 48%, rgba(255,255,255,.2), transparent 65%), rgba(43,27,77,.28)"
      className={s.screen}
    >
      <div className={[s.grid, s.hud].join(' ')}>
        <span className={s.gridPlace} data-df-numeric>{String(gridSpot).padStart(2, '0')}</span>
        <span className={s.gridMeta}>
          <span className={s.gridField}>/{field}</span>
          <span className={s.gridCaption}>GRID SPOT</span>
        </span>
      </div>

      <div className={[s.checkpoints, s.hud].join(' ')}>
        <span className={s.cpLabel}>CHECKPOINT 00 / {String(checkpoints).padStart(2, '0')}</span>
        <Pips total={checkpoints} done={0} />
        <span className={s.pb}>{personalBest}</span>
      </div>

      <div className={s.round}>
        <span className={s.roundNo}>ROUND {round} OF {rounds}</span>
        <span className={s.roundTrack}>{track}</span>
        <Chip tone="race">{mode}</Chip>
      </div>

      <div className={s.counter}>
        <svg className={s.ring} viewBox="0 0 120 120" aria-hidden="true">
          <circle className={s.ringDisc} cx="60" cy="60" r="52" />
          <circle className={s.ringSweep} cx="60" cy="60" r="52" transform="rotate(-90 60 60)" />
        </svg>
        {BEATS.map((b, i) => (
          <span key={b} className={[s.beat, b === 'GO!' && s.go].filter(Boolean).join(' ')} style={delay(i)}>{b}</span>
        ))}
      </div>

      <p className={s.feed}>GAMEPLAY FEED · BEANS ON THE START LINE</p>

      <div className={s.line}>
        <span className={s.lineLabel}>ON THE LINE</span>
        <span className={s.lineBeans}>
          {onTheLine.map((skin, i) => (
            <Avatar key={i} skin={skin} size={2.65} ring={i === 0 ? 'var(--df-color-accent)' : undefined} />
          ))}
          <span className={s.more}>+{othersOnTheLine}</span>
        </span>
      </div>

      <div className={s.beats}>
        {BEATS.map((b, i) => <span key={b} className={s.beatChip} style={delay(i)}>{b}</span>)}
      </div>
    </Stage>
  );
}
