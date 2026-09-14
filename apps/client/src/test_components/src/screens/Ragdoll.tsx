import Stage from '../ui/Stage';
import s from './Ragdoll.module.css';

export interface RagdollProps {
  by?: string;
  /** Impact speed. */
  speed?: string;
  hitsTaken?: number;
  ragdollFor?: string;
  /** Falsy hides the edge warning. */
  warning?: string | null;
}

export default function Ragdoll({
  by = 'SPLATTO', speed = '11.4 m/s', hitsTaken = 4,
  ragdollFor = '1.8s', warning = 'ONE HIT FROM THE EDGE',
}: RagdollProps) {
  return (
    <Stage
      background="var(--df-stage-tension)"
      field="var(--df-field-dash)"
      jolt
      className={s.screen}
      overlay={
        <div className={s.fx}>
          <div className={s.closeIn} />
          <div className={s.dustWrap}>
            <span className={s.puff} />
            <span className={[s.puff, s.puffSmall].join(' ')} />
          </div>
        </div>
      }
    >
      <div className={s.hits}>
        <span className={s.hitsLabel}>HITS TAKEN</span>
        <span className={s.hitsValue} data-df-numeric>{String(hitsTaken).padStart(2, '0')}</span>
      </div>

      <span />

      {warning && (
        <div className={s.warning}>
          <svg viewBox="0 0 18 16" aria-hidden="true"><path d="M9 0l9 16H0z" /></svg>
          {warning}
        </div>
      )}

      <div className={s.slam}>
        <span className={s.badge}>IMPACT</span>
        <span className={s.word}>FLOPPED</span>
        <span className={s.by}>SLAMMED BY {by} · {speed}</span>
      </div>

      <div className={s.getUp}>
        <div className={s.getUpHead}>
          <span>GET UP</span>
          <span className={s.mash}>MASH SPACE</span>
        </div>
        <div className={s.track}><div className={s.fill} /></div>
        <div className={s.keys}>
          <span className={s.keyCap}>SPACE</span>
          <span className={s.timer}>RAGDOLL {ragdollFor}</span>
        </div>
      </div>

      <p className={s.feed}>GAMEPLAY FEED · BEAN WENT LIMP</p>
    </Stage>
  );
}
