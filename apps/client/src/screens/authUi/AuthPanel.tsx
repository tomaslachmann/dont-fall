import type { CSSProperties, ReactNode } from 'react';
import s from './AuthPanel.module.css';

export interface PanelProps {
  children?: ReactNode;
  /** Deeper bevel + drop, for a panel floating over a scrim. */
  modal?: boolean;
  className?: string;
  style?: CSSProperties;
}

export default function Panel({ children, modal, className, style }: PanelProps) {
  return (
    <div className={[s.panel, modal && s.modal, className].filter(Boolean).join(' ')} style={style}>
      {children}
    </div>
  );
}

export function PanelHead({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className={s.head}>
      <div className={s.title}>{title}</div>
      {children}
    </div>
  );
}

export function Rows({ children, className }: { children?: ReactNode; className?: string }) {
  return <div className={[s.rows, className].filter(Boolean).join(' ')}>{children}</div>;
}

export function Row({ children, className }: { children?: ReactNode; className?: string }) {
  return <div className={[s.row, className].filter(Boolean).join(' ')}>{children}</div>;
}
