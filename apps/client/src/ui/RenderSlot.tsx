import type { CSSProperties } from 'react';
import s from './RenderSlot.module.css';

export interface RenderSlotProps {
  label?: string | undefined;
  /** Second line — what the render is doing, e.g. "IDLE + WIN POSE LOOP". */
  sub?: string | undefined;
  /** Stands on the stage floor: no bottom border, bottom-aligned. */
  grounded?: boolean | undefined;
  /** Idle wobble, for hero renders. */
  wobble?: boolean | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
}

export default function RenderSlot({
  label = 'NO 3D PREVIEW', sub, grounded, wobble, className, style,
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
