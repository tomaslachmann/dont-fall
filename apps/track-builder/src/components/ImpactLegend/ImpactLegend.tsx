import css from './ImpactLegend.module.css';
import { IMPACT, IMPACT_ORDER } from '../../lib/impact';

/** Never colour alone: every band carries its glyph and its word. */
export function ImpactLegend() {
  return (
    <div className={css.root}>
      <span className={css.kicker}>IMPACT</span>
      {IMPACT_ORDER.map((k) => (
        <div key={k} className={css.row}>
          <span className={css.badge} style={{ background: IMPACT[k].color, color: IMPACT[k].ink }}>
            {IMPACT[k].glyph}
          </span>
          <span className={css.word}>{IMPACT[k].word}</span>
        </div>
      ))}
    </div>
  );
}
