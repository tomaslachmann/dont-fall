import Meter from '../ui/Meter';
import s from './DashMeter.module.css';

export interface DashMeterProps {
  /** How far the recharge has come, 0–1 — already rounded to what is drawn (ADR 0088). */
  charge: number;
  /** Whether the Dash can fire right now. The exact flag, not `charge === 1`. */
  ready: boolean;
}

/**
 * The Dash recharge, on both Round HUDs (ADR 0092). A fifteen-second wait is
 * long enough that a Player has to be able to *see* it coming back — without
 * this the only way to know is to press the button and find out.
 *
 * Two states, not a gradient of them: filling, and ready. The ready state is
 * the one that matters in a Round (it is what changes what you do next), so
 * it gets the colour and the word rather than a full bar the eye has to
 * measure.
 */
export default function DashMeter({ charge, ready }: DashMeterProps) {
  return (
    <div className={[s.dash, ready && s.ready].filter(Boolean).join(' ')}>
      <span className={s.label}>{ready ? 'DASH READY' : 'DASH'}</span>
      <Meter value={Math.round(charge * 100)} tone={ready ? 'go' : 'speed'} height={1.1} className={s.meter} />
    </div>
  );
}
