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
  /** Live, this is one outcome — your run just ended. The two-beat default is the mock's alternation, for prop-less preview only. */
  outcomes?: Outcome[];
  position?: number;
  field?: number;
  checkpoints?: number;
  /** Checkpoints actually crossed — a run that didn't finish leaves pips empty. Defaults to all. */
  checkpointsDone?: number;
  /** Null while no persisted best exists — the line hides instead of mocking one. */
  personalBest?: string | null;
  nextRoundIn?: string;
  onSpectate?: () => void;
  /** Mid-Round there is no standings table yet — rendered only when provided. */
  onScoreboard?: () => void;
  onLeave?: () => void;
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
  checkpointsDone, personalBest = null, nextRoundIn = '0:09',
  onSpectate, onScoreboard, onLeave, feel,
}: FinishedOrOutProps) {
  const done = checkpointsDone ?? checkpoints;
  // No background, field, or sheen on the Stage: the verdict slams over the
  // live Round (reference 1r, same overlay discipline as the Countdown) —
  // the flash and the beat fire once per outcome, keyed, never looping.
  return (
    <Stage
      feel={feel}
      className={s.screen}
      overlay={
        <div className={s.verdict}>
          {outcomes.map((o) => (
            <div key={o.badge} className={[s.flash, o.out && s.flashOut].filter(Boolean).join(' ')} />
          ))}
          {outcomes.map((o) => (
            <div key={o.badge} className={s.beat}>
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
        <span className={s.cpLabel}>CHECKPOINT {String(done).padStart(2, '0')} / {String(checkpoints).padStart(2, '0')}</span>
        <Pips total={checkpoints} done={done} />
        {personalBest && <span className={s.pb}>{personalBest}</span>}
      </div>

      <p className={s.feed}>GAMEPLAY FEED · RUN ENDING</p>

      <div className={s.actions}>
        {onSpectate && <JellyButton variant="tile" centered onClick={onSpectate}>SPECTATE</JellyButton>}
        {onScoreboard && <JellyButton variant="pill" tone="glass" centered onClick={onScoreboard}>SCOREBOARD</JellyButton>}
        {onLeave && <JellyButton variant="pill" tone="glass" centered onClick={onLeave}>LEAVE</JellyButton>}
        <span className={s.timer}>NEXT ROUND IN {nextRoundIn}</span>
      </div>
    </Stage>
  );
}
