import type { CSSProperties } from 'react';
import Stage from '../ui/Stage';
import s from './HitFeedback.module.css';

export interface HitFeedbackProps {
  /**
   * This down episode was caused by a Hit (a fresh `ragdollEpoch` with
   * cause `"Hit"`, arriving with or just after the landing itself) — the
   * knockout: the design's whole flash, and the crack. A landing that
   * leaves you standing is only a light red at the edges, with no word.
   * These two are the only things the sim actually says about an incoming
   * Hit (M9 ticket 09): no attacker, no direction, no damage, no combo, no
   * stagger meter — the mock's versions of all five are invented mechanics
   * and stay unbuilt.
   */
  knockedDown?: boolean;
}

/** One stroke of the crack, and when it starts to draw (s) — a branch starts where its parent has reached. */
interface Crack {
  d: string;
  at: number;
  /** How long it takes to draw (s). */
  take: number;
  weight: 'trunk' | 'branch' | 'hair';
}

/**
 * The crack a knockout paints (user's call, 2026-09-18: "at se při knock
 * outu maluje"). The design's own four strokes are kept — the trunk from the
 * impact across to the left and its two branches — and grown into a whole
 * break: more trunks out of the point of impact (where the bloom is, 76% 40%
 * of the frame), branches off their bends, hairlines off those. Each stroke
 * draws from its root outward, starting as its parent's line reaches it.
 */
const CRACKS: readonly Crack[] = [
  // Trunks, out of the point of impact.
  { d: 'M980 300L860 340L770 318L630 372L522 394L442 460', at: 0.04, take: 0.34, weight: 'trunk' },
  { d: 'M980 300L1060 262L1140 280L1238 232', at: 0.04, take: 0.22, weight: 'trunk' },
  { d: 'M980 300L1010 210L990 120L1030 36', at: 0.06, take: 0.24, weight: 'trunk' },
  { d: 'M980 300L1004 402L968 486L1002 600', at: 0.05, take: 0.26, weight: 'trunk' },
  // Branches, off the trunks' bends — the design's two first.
  { d: 'M860 340L820 436L844 514', at: 0.1, take: 0.2, weight: 'branch' },
  { d: 'M770 318L706 248L610 224', at: 0.14, take: 0.2, weight: 'branch' },
  { d: 'M1140 280L1172 352L1150 420', at: 0.16, take: 0.18, weight: 'branch' },
  { d: 'M990 120L936 88L880 96', at: 0.2, take: 0.16, weight: 'branch' },
  { d: 'M968 486L902 520L860 590', at: 0.22, take: 0.18, weight: 'branch' },
  // Hairlines, last.
  { d: 'M820 436L776 470', at: 0.28, take: 0.12, weight: 'hair' },
  { d: 'M706 248L690 186', at: 0.3, take: 0.12, weight: 'hair' },
  { d: 'M522 394L498 330', at: 0.34, take: 0.12, weight: 'hair' },
  { d: 'M1172 352L1226 372', at: 0.3, take: 0.1, weight: 'hair' },
  { d: 'M1010 210L1066 184', at: 0.24, take: 0.1, weight: 'hair' },
];

const stroke = (crack: Crack) => ({ '--df-fx-delay': `${crack.at}s`, '--df-fx-take': `${crack.take}s` }) as CSSProperties;

/**
 * The incoming-Hit flash (M9 ticket 09, Hit-received only) — a one-shot
 * React overlay over the live canvas (ADR 0060), fired off your own
 * `hitReactEpoch` rising and dismissed on a display timer by the shell.
 * An overlay, not a screen (the Countdown rule): no Stage
 * background/field/sheen, so the live game stays visible underneath, and
 * pointer-transparent throughout, so a flash mid-Round never eats input.
 * Re-mounts per Hit (the shell keys it), which restarts the fx.
 */
export default function HitFeedback({ knockedDown = false }: HitFeedbackProps) {
  if (!knockedDown) {
    // No word on screen — the label is for a screen reader only.
    return (
      <Stage
        className={s.screen}
        overlay={
          <div className={s.fx}>
            <div className={s.tint} role="status" aria-label="YOU GOT HIT" />
          </div>
        }
      />
    );
  }
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
              <g className={s.shadow}>
                {CRACKS.map((crack) => (
                  <path key={crack.d} d={crack.d} pathLength={1} className={s[crack.weight]} style={stroke(crack)} />
                ))}
              </g>
              <g className={s.line}>
                {CRACKS.map((crack) => (
                  <path key={crack.d} d={crack.d} pathLength={1} className={s[crack.weight]} style={stroke(crack)} />
                ))}
              </g>
            </svg>
          </div>
        </div>
      }
    >
      <p className={s.banner}>
        <span role="status" aria-label="KNOCKED DOWN">
          KNOCKED DOWN
        </span>
      </p>
      <p className={s.sub}>A HIT PUT YOU ON THE DECK</p>
    </Stage>
  );
}
