import { useCallback, useState } from 'react';
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import s from './JellyButton.module.css';

export type ButtonVariant = 'hero' | 'tile' | 'pill';
export type ButtonTone = 'accent' | 'danger' | 'go' | 'glass' | 'ink';

interface Ring { id: number; x: number; y: number }

export interface JellyButtonProps {
  children?: ReactNode;
  /** Wide-tracked line above the label. */
  kicker?: ReactNode;
  /** Small line below the label. */
  sub?: ReactNode;
  icon?: ReactNode;
  variant?: ButtonVariant;
  /** Semantic color. accent = the one primary action on a screen. */
  tone?: ButtonTone;
  /** Center the label (no trailing glyph). */
  centered?: boolean;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** tone -> the three custom props the stylesheet reads. */
const TONES: Record<ButtonTone, CSSProperties> = {
  accent: {},
  danger: { '--df-btn-bg': 'var(--df-color-danger)', '--df-btn-shade': 'var(--df-color-danger-shade)', '--df-btn-ink': 'var(--df-color-on-brand)' } as CSSProperties,
  go:     { '--df-btn-bg': 'var(--df-color-go)', '--df-btn-shade': 'var(--df-color-go-shade)', '--df-btn-ink': 'var(--df-color-go-ink)' } as CSSProperties,
  glass:  { '--df-btn-bg': 'var(--df-color-glass)', '--df-btn-shade': 'var(--df-color-shadow)' } as CSSProperties,
  ink:    { '--df-btn-bg': 'var(--df-color-ink)', '--df-btn-shade': 'rgba(0,0,0,.35)', '--df-btn-ink': 'var(--df-color-on-brand)' } as CSSProperties,
};

export default function JellyButton({
  children, kicker, sub, icon, variant = 'hero', tone = 'accent',
  centered, onClick, disabled, className, style,
}: JellyButtonProps) {
  const [rings, setRings] = useState<Ring[]>([]);

  const fire = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const id = Date.now() + Math.random();
    setRings((v) => [...v, { id, x: e.clientX - box.left, y: e.clientY - box.top }]);
    window.setTimeout(() => setRings((v) => v.filter((r) => r.id !== id)), 450);
    onClick?.(e);
  }, [onClick]);

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={fire}
      className={[s.btn, s[variant], centered && s.centered, className].filter(Boolean).join(' ')}
      style={{ ...TONES[tone], ...style }}
    >
      <span className={s.body}>
        {kicker && <span className={s.kicker}>{kicker}</span>}
        {icon && <span className={s.icon}>{icon}</span>}
        <span className={s.label}>{children}</span>
        {sub && <span className={s.sub}>{sub}</span>}
      </span>

      {variant === 'hero' && !centered && (
        <span className={s.glyph}>
          <svg viewBox="0 0 26 30" aria-hidden="true"><path d="M0 0l26 15L0 30z" /></svg>
        </span>
      )}

      {rings.map((r) => (
        <span key={r.id} className={s.ring} style={{ left: r.x, top: r.y }} />
      ))}
    </button>
  );
}
