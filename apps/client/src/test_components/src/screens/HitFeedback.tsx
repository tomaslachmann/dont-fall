import type { CSSProperties } from 'react';
import Stage from '../ui/Stage';
import Avatar from '../ui/Avatar';
import type { Skin } from '../ui/Avatar';
import s from './HitFeedback.module.css';

export interface HitFeedbackProps {
  attacker?: string;
  attackerSkin?: Skin;
  /** Where it came from, in words. */
  direction?: string;
  /** Wedge rotation in degrees. 0 = from the right. */
  angle?: number;
  damage?: number;
  /** e.g. "HEAVY PUNCH · RIGHT" */
  kind?: string;
  combo?: number;
  comboMax?: number;
}

const FistIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4H4v16h4M16 4h4v16h-4" /></svg>
);

export default function HitFeedback({
  attacker = 'FLOPPO', attackerSkin = 'pink', direction = 'FROM YOUR RIGHT',
  angle = 0, damage = 35, kind = 'HEAVY PUNCH · RIGHT', combo = 3, comboMax = 4,
}: HitFeedbackProps) {
  return (
    <Stage
      background="var(--df-stage-race)"
      field="var(--df-field-race)"
      sheen="radial-gradient(85% 70% at 50% 48%, rgba(255,255,255,.14), transparent 65%)"
      jolt
      className={s.screen}
      overlay={
        <div className={s.fx} style={{ '--df-hit-angle': `${angle}deg` } as CSSProperties}>
          <div className={s.snap} />
          <div className={s.bleed} />
          <div className={s.bloom} />
          <div className={s.wedgeWrap}><div className={s.wedge} /></div>
          <div className={s.cracks}>
            <svg viewBox="0 0 1280 720" preserveAspectRatio="none" aria-hidden="true">
              <path d="M980 300l-120 40-90-22-140 54" />
              <path d="M860 340l-40 96 24 78" />
              <path d="M770 318l-64-70-96-24" />
              <path d="M630 372l-108 22-80 66" />
            </svg>
          </div>
        </div>
      }
    >
      <div className={s.attacker}>
        <Avatar skin={attackerSkin} size={3.1} />
        <span className={s.attackerText}>
          <span className={s.attackerName}>{attacker} HIT YOU</span>
          <span className={s.attackerDir}>{direction}</span>
        </span>
      </div>

      <div className={s.combo}>
        <span className={s.comboLabel}>HITS IN A ROW</span>
        <span className={s.comboValue} data-df-numeric>×{combo}</span>
        <span className={s.comboPips}>
          {Array.from({ length: comboMax }, (_, i) => (
            <span key={i} className={[s.comboPip, i < combo && s.comboPipOn].filter(Boolean).join(' ')} />
          ))}
        </span>
      </div>

      <div className={s.damage}>
        <span className={s.damageValue} data-df-numeric>-{damage}</span>
        <span className={s.damageTag}><FistIcon />{kind}</span>
      </div>

      <p className={s.feed}>GAMEPLAY FEED · FIST CONNECTS</p>

      <div className={s.stagger}>
        <span className={s.staggerLabel}>YOUR STAGGER</span>
        <span className={s.staggerTrack}><span className={s.staggerFill} /></span>
        <span className={s.staggerWarn}>ONE MORE AND YOU RAGDOLL</span>
      </div>
    </Stage>
  );
}
