import Stage from '../ui/Stage';
import Meter from '../ui/Meter';
import { Danger } from '../ui/Vignette';
import s from './Grabbed.module.css';

export interface GrabbedProps {
  /** Who has you. */
  by?: string;
  /** Mash progress, 0-100. */
  progress?: number;
}

export default function Grabbed({ by = 'FLOPPO', progress = 62 }: GrabbedProps) {
  return (
    <Stage
      background="var(--df-stage-race)"
      field="var(--df-field-race)"
      className={s.screen}
      overlay={<Danger />}
    >
      <div className={s.stack}>
        <span className={s.by}>{by} HAS YOU</span>
        <span className={s.word}>GRABBED</span>
        <span className={s.prompt}>MASH A TO BREAK FREE</span>
        <Meter value={progress} height={2} className={s.meter} />
      </div>
    </Stage>
  );
}
