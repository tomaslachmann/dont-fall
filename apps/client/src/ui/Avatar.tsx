import type { CSSProperties } from 'react';
import s from './Avatar.module.css';

export type Skin = 'pink' | 'cyan' | 'mint' | 'gold' | 'grape';

export interface AvatarProps {
  skin?: Skin | undefined;
  /** Diameter as a multiple of --df-u. Default 3 (~38px on a 1280 stage). */
  size?: number | undefined;
  /** Outline color, e.g. to mark the local player. */
  ring?: string | undefined;
}

export default function Avatar({ skin = 'pink', size = 3, ring }: AvatarProps) {
  return (
    <div
      className={[s.avatar, s[skin], ring && s.ringed].filter(Boolean).join(' ')}
      style={{ '--df-avatar-size': `calc(var(--df-u) * ${size})`, '--df-avatar-ring': ring } as CSSProperties}
    />
  );
}
