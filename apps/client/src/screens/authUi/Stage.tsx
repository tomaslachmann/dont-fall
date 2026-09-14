import type { CSSProperties, ReactNode } from 'react';
import type { Feel } from './tokens';
import s from './Stage.module.css';

export interface StageProps {
  /** A --df-stage-* token value, or any CSS background. */
  background?: string;
  /** Stripe field token, e.g. var(--df-field-race). Sits behind the sheen. */
  field?: string;
  /** Soft light layer, e.g. var(--df-sheen-lift). */
  sheen?: string;
  /** Camera jolt on the field (hit feedback). */
  jolt?: boolean;
  /** Press personality for every button inside. */
  feel?: Feel;
  /** Screen content — laid out in a padded grid. */
  children?: ReactNode;
  /** Overlay layers (vignettes, verdicts) — stacked above the content, full bleed. */
  overlay?: ReactNode;
  /** Styles the CONTENT grid — this is where a screen declares its own tracks. */
  className?: string;
  /** Styles the stage itself (background/radius overrides). Rarely needed. */
  stageClassName?: string;
  style?: CSSProperties;
}

export default function Stage({
  background, field, sheen, jolt, feel = 'snappy', children, overlay, className, stageClassName, style,
}: StageProps) {
  return (
    <div className={s.outer}>
      <div
        className={[s.stage, stageClassName].filter(Boolean).join(' ')}
        data-df-feel={feel}
        style={{ background, ...style }}
      >
        {field && <div className={[s.field, jolt && s.jolt].filter(Boolean).join(' ')} style={{ background: field }} />}
        {sheen && <div className={s.sheen} style={{ background: sheen }} />}
        {children && <div className={[s.content, className].filter(Boolean).join(' ')}>{children}</div>}
        {overlay}
      </div>
    </div>
  );
}
