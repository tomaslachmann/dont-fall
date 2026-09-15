import type { ReactNode } from 'react';
import css from './StatusPlate.module.css';

interface Props {
  /** error gets the pink plate and the ! badge — status never speaks in grey alone */
  kind: 'loading' | 'empty' | 'error' | 'ok';
  children: ReactNode;
}

export function StatusPlate({ kind, children }: Props) {
  return (
    <div className={[css.plate, css[kind]].join(' ')} role={kind === 'error' ? 'alert' : undefined}>
      {kind === 'loading' && <span className={css.spinner} />}
      {kind === 'error' && <span className={css.badge}>!</span>}
      {kind === 'ok' && <span className={css.tick}>✓</span>}
      <span className={css.label}>{children}</span>
    </div>
  );
}
