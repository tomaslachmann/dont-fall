import type { ReactNode } from 'react';
import s from './Pill.module.css';

export type PillTone = 'glass' | 'danger' | 'go' | 'plate';

export interface PillProps {
  children?: ReactNode | undefined;
  tone?: PillTone | undefined;
  /** Drop the bevel (for pills sitting on a dark plate). */
  flat?: boolean | undefined;
  className?: string | undefined;
}

export default function Pill({ children, tone = 'glass', flat, className }: PillProps) {
  return (
    <span className={[s.pill, s[tone], flat && s.flat, className].filter(Boolean).join(' ')}>
      {children}
    </span>
  );
}

export function StatTile({ label, value, accent }: { label: ReactNode; value: ReactNode; accent?: boolean }) {
  return (
    <div className={s.stat}>
      <span className={s.statLabel}>{label}</span>
      <span className={[s.statValue, accent && s.statAccent].filter(Boolean).join(' ')} data-df-numeric>{value}</span>
    </div>
  );
}
