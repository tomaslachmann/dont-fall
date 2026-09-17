import { useCallback, useState } from 'react';
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import type { UiSound } from '../audio/uiSounds';
import s from './JellyButton.module.css';

export type ButtonVariant = 'hero' | 'tile' | 'pill';
export type ButtonTone = 'accent' | 'danger' | 'go' | 'glass' | 'ink';

export interface JellyButtonProps {
  children?: ReactNode | undefined;
  /** Wide-tracked line above the label. */
  kicker?: ReactNode | undefined;
  /** Small line below the label. */
  sub?: ReactNode | undefined;
  icon?: ReactNode | undefined;
  variant?: ButtonVariant | undefined;
  /** Semantic color. accent = the one primary action on a screen. */
  tone?: ButtonTone | undefined;
  /** Center the label (no trailing glyph). */
  centered?: boolean | undefined;
  onClick?: ((e: MouseEvent<HTMLButtonElement>) => void) | undefined;
  disabled?: boolean | undefined;
  /** What pressing it sounds like (M14 ticket 12): a click, unless it confirms or goes back. */
  sound?: UiSound | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
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
  centered, onClick, disabled, sound, className, style,
}: JellyButtonProps) {
  const fire = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    onClick?.(e);
  }, [onClick]);

  return (
    <button
      type="button"
      disabled={disabled}
      data-ui-sound={sound}
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
    </button>
  );
}
