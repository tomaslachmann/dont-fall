import { useState, type CSSProperties } from 'react';
import type { AvatarLook } from '../lib/avatar.js';
import { stripesFor } from '../lib/bodyColors.js';
import s from './Avatar.module.css';

export interface AvatarProps {
  /**
   * Whose avatar (ADR 0110): their picture over the design's striped disc in
   * their bean's Colour. Omitted, the default bean's disc.
   */
  look?: AvatarLook | undefined;
  /** Diameter as a multiple of --df-u. Default 3 (~38px on a 1280 stage). */
  size?: number | undefined;
  /** Outline color, e.g. to mark the local player. */
  ring?: string | undefined;
  /**
   * Whether this Player is talking right now (ADR 0111). Drawn as a
   * go-coloured halo *outside* {@link ring}, so a bean who is both yours and
   * talking wears both cues rather than one replacing the other.
   */
  speaking?: boolean | undefined;
}

export default function Avatar({ look, size = 3, ring, speaking }: AvatarProps) {
  const [a, b] = stripesFor(look?.color);
  // A picture that fails (no upload and no Discord picture answers 404) leaves
  // the disc — remembered per address, so a new picture gets its own chance.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = look?.src ?? null;
  return (
    <div
      className={[s.avatar, ring && s.ringed, speaking && s.speaking].filter(Boolean).join(' ')}
      style={{
        '--df-avatar-size': `calc(var(--df-u) * ${size})`,
        '--df-avatar-ring': ring,
        '--df-skin-a': a,
        '--df-skin-b': b,
      } as CSSProperties}
    >
      {src !== null && src !== failedSrc && (
        <img className={s.picture} src={src} alt="" draggable={false} onError={() => setFailedSrc(src)} />
      )}
    </div>
  );
}
