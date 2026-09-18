import Stage from '../ui/Stage';
import Avatar from '../ui/Avatar';
import type { Skin } from '../ui/Avatar';
import Pill from '../ui/Pill';
import DashMeter from './DashMeter';
import { Pips } from '../ui/Meter';
import type { Feel } from '../tokens';
import s from './RaceHUD.module.css';

export interface RaceHUDProps {
  /** Placement in this Round if it ended now; `null` until the server has placed you. */
  position: number | null;
  field: number;
  /** mm:ss */
  time: string;
  /** Tenths tail, rendered smaller. */
  ms: string;
  /** Signed split at your latest Checkpoint, e.g. "+2.478"; `null` hides it. */
  delta: string | null;
  /** The split is a lead over the next arrival, not a gap to the first. */
  deltaAhead?: boolean;
  checkpoint: number;
  checkpoints: number;
  /** "PB 01:19.904"; `null` (no record, or an anonymous seat) hides the line. */
  personalBest: string | null;
  /** Who is right behind you; `null` hides the callout. */
  threat: { name: string; skin: Skin } | null;
  /** Dash recharge, 0–1 (ADR 0092). */
  dashCharge: number;
  /** Whether the Dash can fire right now. */
  dashReady: boolean;
  feel?: Feel;
}

/**
 * 1b — the Race HUD, live over the running Round (ADR 0088). No Stage
 * background, field or sheen: the game shows through, as under the Countdown.
 * Every value arrives already rounded to what is drawn.
 */
export default function RaceHUD({
  position, field, time, ms, delta, deltaAhead, checkpoint, checkpoints, personalBest, threat,
  dashCharge, dashReady, feel,
}: RaceHUDProps) {
  return (
    <Stage feel={feel} className={s.screen}>
      <div className={s.position}>
        <span className={s.place} data-df-numeric>{position === null ? '--' : String(position).padStart(2, '0')}</span>
        <span className={s.positionMeta}>
          <span className={s.field}>/{field}</span>
          <span className={s.caption}>POSITION</span>
        </span>
      </div>

      <div className={s.clock}>
        <span className={s.time} data-df-numeric>{time}<span className={s.ms}>{ms}</span></span>
        {delta !== null && (
          <Pill tone={deltaAhead ? 'go' : 'danger'}>
            <svg viewBox="0 0 8 8" aria-hidden="true">
              <path d={deltaAhead ? 'M4 0L8 7H0z' : 'M4 8L0 1h8z'} />
            </svg>
            <span data-df-numeric>{delta}</span>
          </Pill>
        )}
      </div>

      <div className={s.checkpoints}>
        <span className={s.cpLabel}>
          CHECKPOINT {String(checkpoint).padStart(2, '0')} / {String(checkpoints).padStart(2, '0')}
        </span>
        <Pips total={checkpoints} done={checkpoint} />
        {personalBest !== null && <span className={s.pb}>{personalBest}</span>}
      </div>

      <div className={s.dash}>
        <DashMeter charge={dashCharge} ready={dashReady} />
      </div>

      {threat && (
        <div className={s.threat}>
          <Avatar skin={threat.skin} size={2.65} />
          <span>{threat.name} IS RIGHT BEHIND YOU</span>
          <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 14L0 4h14z" /></svg>
        </div>
      )}
    </Stage>
  );
}
