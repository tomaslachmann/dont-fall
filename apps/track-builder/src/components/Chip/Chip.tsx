import type { ReactNode } from 'react';
import css from './Chip.module.css';

interface Props {
  children: ReactNode;
  /** quiet = trough, brand/ink/accent/go/danger = filled */
  tone?: 'quiet' | 'brand' | 'ink' | 'accent' | 'go' | 'danger';
  active?: boolean;
  as?: 'span' | 'button';
  onClick?: () => void;
  title?: string;
}

export function Chip({ children, tone = 'quiet', active, as = 'span', onClick, title }: Props) {
  const Tag = onClick ? 'button' : as;
  return (
    <Tag type={onClick ? 'button' : undefined} title={title} onClick={onClick}
      className={[css.chip, css[tone], active ? css.active : ''].join(' ')}>
      {children}
    </Tag>
  );
}
