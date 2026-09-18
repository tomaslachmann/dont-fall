import Stage from '../ui/Stage';
import Meter from '../ui/Meter';
import { Danger } from '../ui/Vignette';
import type { HeldPhase } from '@dont-fall/shared';
import s from './Grabbed.module.css';

export interface GrabbedProps {
  /** Who has you. */
  by: string;
  /** Your Struggle, or Limp — lost it, or grabbed already down (ADR 0104). */
  phase: HeldPhase;
  /** Mash progress, 0-100. */
  progress: number;
  /** The two keys to wiggle between, as bound (left, right). */
  wiggleKeys: [string, string];
}

/**
 * Being held (ADR 0104) — the design's `Grabbed` screen, ported as it is. The
 * one deviation: no Stage background or field. It floats over the live Round
 * (ADR 0060), so you see where you are being carried.
 *
 * Limp has no screen of its own in the design, so it keeps this one with
 * nothing to press: the prompt says why, and the meter is gone.
 */
export default function Grabbed({ by, phase, progress, wiggleKeys }: GrabbedProps) {
  const limp = phase === 'limp';
  return (
    <Stage className={s.screen} overlay={<Danger />}>
      <div className={s.stack}>
        <span className={s.by}>{by} HAS YOU</span>
        <span className={s.word}>GRABBED</span>
        <span className={s.prompt}>{limp ? 'KNOCKED OUT' : `MASH ${wiggleKeys[0]} ${wiggleKeys[1]} TO BREAK FREE`}</span>
        {!limp && <Meter value={progress} height={2} className={s.meter} />}
      </div>
    </Stage>
  );
}
