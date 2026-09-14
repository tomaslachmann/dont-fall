import type { CSSProperties, ReactNode } from 'react';
import s from './SlamText.module.css';

export interface SlamTextProps {
  children?: ReactNode | undefined;
  kicker?: ReactNode | undefined;
  /** Danger-colored kicker (knocked out) instead of accent (finished). */
  danger?: boolean | undefined;
  /** Black snap instead of a white flash. */
  dark?: boolean | undefined;
  /** Seconds for the whole slam-hold-drop beat. */
  duration?: number | undefined;
}

export default function SlamText({ children, kicker, danger, dark, duration = 3 }: SlamTextProps) {
  return (
    <div className={s.layer} style={{ '--df-slam-dur': `${duration}s` } as CSSProperties}>
      <div className={[s.flash, dark && s.dark].filter(Boolean).join(' ')} />
      <div className={s.stack}>
        {kicker && <span className={[s.kicker, danger && s.accentKicker].filter(Boolean).join(' ')}>{kicker}</span>}
        <span className={s.word}>{children}</span>
      </div>
    </div>
  );
}
