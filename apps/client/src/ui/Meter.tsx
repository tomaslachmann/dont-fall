import type { CSSProperties, ReactNode } from 'react';
import s from './Meter.module.css';

export type MeterTone = 'accent' | 'go' | 'danger' | 'speed';

export interface MeterProps {
  /** 0-100. Ignored when `animated` is set. */
  value?: number | undefined;
  tone?: MeterTone | undefined;
  /** Track height as a multiple of --df-u. */
  height?: number | undefined;
  /** Loop the demo mash animation instead of using `value`. */
  animated?: boolean | undefined;
  label?: ReactNode | undefined;
  className?: string | undefined;
}

export default function Meter({ value = 0, tone = 'accent', height, animated, label, className }: MeterProps) {
  const style = {
    '--df-meter-value': `${Math.max(0, Math.min(100, value))}%`,
    ...(height ? { '--df-meter-height': `calc(var(--df-u) * ${height})` } : null),
  } as CSSProperties;

  return (
    <div className={[s.meter, className].filter(Boolean).join(' ')} style={style}>
      {label && <span className={s.label}>{label}</span>}
      <div className={s.track}>
        <div className={[s.fill, tone !== 'accent' && s[tone], animated && s.animated].filter(Boolean).join(' ')} />
      </div>
    </div>
  );
}

export function Pips({ total = 7, done = 4 }: { total?: number; done?: number }) {
  return (
    <div className={s.pips}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={[s.pip, i < done && s.done].filter(Boolean).join(' ')} />
      ))}
    </div>
  );
}
