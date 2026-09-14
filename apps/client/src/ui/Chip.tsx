import type { ReactNode } from 'react';
import s from './Chip.module.css';

export type ChipTone =
  | 'ready' | 'waiting' | 'race' | 'survival' | 'any'
  | 'host' | 'plate' | 'glass' | 'out' | 'closing';

export interface ChipProps {
  children?: ReactNode | undefined;
  tone?: ChipTone | undefined;
  /** Leading status dot (ready / waiting). */
  dot?: boolean | undefined;
  /** Larger step, for standalone status pills over gameplay. */
  lg?: boolean | undefined;
  className?: string | undefined;
}

export default function Chip({ children, tone = 'glass', dot, lg, className }: ChipProps) {
  return (
    <span className={[s.chip, s[tone], lg && s.lg, className].filter(Boolean).join(' ')}>
      {dot && <span className={s.dot} />}
      {children}
    </span>
  );
}
