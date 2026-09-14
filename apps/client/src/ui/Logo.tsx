import type { CSSProperties } from 'react';
import s from './Logo.module.css';

export type LogoVariant = 'horizontal' | 'stacked' | 'icon';

export interface LogoProps {
  variant?: LogoVariant | undefined;
  /** Cap height of FALL as a multiple of --df-u. Below ~2.7 use variant="icon". */
  size?: number | undefined;
  /** Ink wordmark with no extrude — for accent or light grounds. */
  mono?: boolean | undefined;
  /** Flat single-step extrude, for small chrome like the menu header. */
  chrome?: boolean | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
}

/** App icon on its own. */
export function LogoMark({ size = 3.6, className, style }: { size?: number | undefined; className?: string | undefined; style?: CSSProperties | undefined }) {
  return (
    <div
      className={[s.mark, className].filter(Boolean).join(' ')}
      style={{ '--df-mark-size': `calc(var(--df-u) * ${size})`, ...style } as CSSProperties}
      aria-hidden="true"
    >
      <span className={s.dot} />
      <span className={s.dot} />
      <span className={s.dot} />
    </div>
  );
}

export default function Logo({ variant = 'horizontal', size = 7.5, mono, chrome, className, style }: LogoProps) {
  if (variant === 'icon') return <LogoMark size={size} className={className} style={style} />;

  return (
    <div
      className={[s.logo, variant === 'stacked' && s.stacked, mono && s.mono, chrome && s.chrome, className].filter(Boolean).join(' ')}
      style={{ '--df-logo-size': `calc(var(--df-u) * ${size})`, ...style } as CSSProperties}
      role="img"
      aria-label="DON'T FALL"
    >
      {variant === 'horizontal' && <LogoMark size={size * 0.85} />}
      <div className={s.word}>
        <span className={s.tag}>DON&rsquo;T</span>
        <span className={s.tumble} aria-hidden="true">
          <span>F</span><span>A</span><span>L</span><span>L</span>
        </span>
      </div>
    </div>
  );
}
