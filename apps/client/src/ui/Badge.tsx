import type { ReactNode } from 'react';
import s from './Badge.module.css';

export function Badge({ children, pulse }: { children?: ReactNode; pulse?: boolean }) {
  return <span className={[s.badge, pulse && s.pulse].filter(Boolean).join(' ')}>{children}</span>;
}
