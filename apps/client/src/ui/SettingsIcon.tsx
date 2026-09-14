import type { CSSProperties } from 'react';
import s from './SettingsIcon.module.css';

export interface SettingsIconProps {
  /** Diameter as a multiple of --df-u. */
  size?: number;
  /** Dark disc + accent cog — for light grounds. Default is the inverse. */
  inverse?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** Eight-tooth plastic cog. Chunky teeth, hard bevel, no thin strokes —
    reads at pill size and keeps the candy-plastic vocabulary. */
export default function SettingsIcon({ size = 2.1, inverse, className, style }: SettingsIconProps) {
  return (
    <span
      className={[s.mark, inverse && s.inverse, className].filter(Boolean).join(' ')}
      style={{ '--df-cog-size': `calc(var(--df-u) * ${size})`, ...style } as CSSProperties}
      aria-hidden="true"
    >
      <svg viewBox="0 0 48 48" className={s.svg}>
        <g className={s.cog}>
          <circle cx="24" cy="24" r="16.4" />
          <rect x="19.4" y="1.6" width="9.2" height="12" rx="2.6" transform="rotate(0 24 24)" />
          <rect x="19.4" y="1.6" width="9.2" height="12" rx="2.6" transform="rotate(45 24 24)" />
          <rect x="19.4" y="1.6" width="9.2" height="12" rx="2.6" transform="rotate(90 24 24)" />
          <rect x="19.4" y="1.6" width="9.2" height="12" rx="2.6" transform="rotate(135 24 24)" />
          <rect x="19.4" y="1.6" width="9.2" height="12" rx="2.6" transform="rotate(180 24 24)" />
          <rect x="19.4" y="1.6" width="9.2" height="12" rx="2.6" transform="rotate(225 24 24)" />
          <rect x="19.4" y="1.6" width="9.2" height="12" rx="2.6" transform="rotate(270 24 24)" />
          <rect x="19.4" y="1.6" width="9.2" height="12" rx="2.6" transform="rotate(315 24 24)" />
        </g>
        <circle className={s.hole} cx="24" cy="24" r="7.2" />
      </svg>
    </span>
  );
}
