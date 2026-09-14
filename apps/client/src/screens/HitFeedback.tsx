import Stage from '../ui/Stage';
import s from './HitFeedback.module.css';

export interface HitFeedbackProps {
  /**
   * This down episode was caused by a Hit (a fresh `ragdollEpoch` with
   * cause `"Hit"`, arriving with or just after the landing itself) — reads
   * KNOCKED DOWN. A stagger-tier or weaker landing reads the plain YOU GOT
   * HIT. These two are the only things the sim actually says about an
   * incoming Hit (M9 ticket 09): no attacker, no direction, no damage, no
   * combo, no stagger meter — the mock's versions of all five are invented
   * mechanics and stay unbuilt.
   */
  knockedDown?: boolean;
}

/**
 * The incoming-Hit flash (M9 ticket 09, Hit-received only) — a one-shot
 * React overlay over the live canvas (ADR 0060), fired off your own
 * `hitReactEpoch` rising and dismissed on a display timer by the shell.
 * An overlay, not a screen (the Countdown rule): no Stage
 * background/field/sheen, so the live game stays visible underneath, and
 * pointer-transparent throughout, so a flash mid-Round never eats input.
 * Re-mounts per Hit (the shell keys it), which restarts the fx loops.
 */
export default function HitFeedback({ knockedDown = false }: HitFeedbackProps) {
  return (
    <Stage
      className={s.screen}
      overlay={
        <div className={s.fx}>
          <div className={s.snap} />
          <div className={s.bleed} />
          <div className={s.bloom} />
          <div className={s.cracks}>
            <svg viewBox="0 0 1280 720" preserveAspectRatio="none" aria-hidden="true">
              <path d="M980 300l-120 40-90-22-140 54" />
              <path d="M860 340l-40 96 24 78" />
              <path d="M770 318l-64-70-96-24" />
              <path d="M630 372l-108 22-80 66" />
            </svg>
          </div>
        </div>
      }
    >
      <p className={s.banner}>
        <span role="status" aria-label={knockedDown ? 'KNOCKED DOWN' : 'YOU GOT HIT'}>
          {knockedDown ? 'KNOCKED DOWN' : 'YOU GOT HIT'}
        </span>
      </p>
      <p className={s.sub}>{knockedDown ? 'A HIT PUT YOU ON THE DECK' : 'A HIT CONNECTED'}</p>
    </Stage>
  );
}
