import type { CSSProperties } from 'react';
import s from './RenderSlot.module.css';

export interface RenderSlotProps {
  label?: string;
  /** Second line — what the render is doing, e.g. "IDLE + WIN POSE LOOP". */
  sub?: string;
  /** Stands on the stage floor: no bottom border, bottom-aligned. */
  grounded?: boolean;
  /** Idle wobble, for hero renders. */
  wobble?: boolean;
  className?: string;
  style?: CSSProperties;
}

export default function RenderSlot({
  label = 'EXISTING CHARACTER RENDER', sub, grounded, wobble, className, style,
}: RenderSlotProps) {
  return (
    <div
      className={[s.slot, grounded && s.grounded, wobble && s.wobble, className].filter(Boolean).join(' ')}
      style={style}
    >
      <span className={s.caption}>
        {label}{sub && <><br />{sub}</>}
      </span>
    </div>
  );
}
