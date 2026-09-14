import type { CSSProperties } from 'react';
import Stage from '../ui/Stage';
import Avatar from '../ui/Avatar';
import type { Skin } from '../ui/Avatar';
import s from './DashFeedback.module.css';

export interface DashFeedbackProps {
  ability?: string;
  abilityNote?: string;
  skin?: Skin;
  topSpeed?: string;
  charges?: number;
  max?: number;
  rechargeIn?: string;
  state?: string;
}

const delay = (n: number) => ({ '--df-fx-delay': `${n}s` } as CSSProperties);

const BoltIcon = () => (
  <svg viewBox="0 0 30 26" aria-hidden="true"><path d="M0 13h13L8 0l14 13-13 0 5 13z" /></svg>
);

export default function DashFeedback({
  ability = 'SHOULDER CHARGE', abilityNote = 'KNOCKS BEANS OFF THE EDGE', skin = 'pink',
  topSpeed = '14.2', charges = 2, max = 3, rechargeIn = '1.4s', state = 'SPRINTING',
}: DashFeedbackProps) {
  return (
    <Stage
      background="var(--df-stage-dash)"
      field="var(--df-field-dash)"
      sheen="radial-gradient(85% 70% at 50% 50%, rgba(255,255,255,.14), transparent 65%)"
      className={s.screen}
      overlay={
        <div className={s.fx}>
          <div className={s.fov} />
          <div className={s.pull}><span className={s.pullCore} /></div>
          <div className={s.streaks}>
            <span className={s.streak} style={delay(0.05)} />
            <span className={[s.streak, s.streakThin].join(' ')} style={delay(0.22)} />
            <span className={[s.streak, s.streakCyan].join(' ')} style={delay(0.14)} />
          </div>
          <div className={s.arcs}>
            <svg viewBox="0 0 1100 520" preserveAspectRatio="none" aria-hidden="true">
              <g className={s.arcWhite}>
                <path d="M700 150C560 120 420 150 300 205" />
                <path d="M720 372C580 402 430 378 310 322" />
              </g>
              <g className={s.arcCyan}>
                <path d="M690 196C555 176 430 200 322 244" />
                <path d="M700 330C566 352 438 330 330 288" />
              </g>
              <g className={s.arcFaint}>
                <path d="M660 108C520 74 372 104 250 168" />
                <path d="M672 414C534 448 386 418 262 356" />
                <path d="M646 262C520 250 400 258 292 268" />
              </g>
            </svg>
          </div>
        </div>
      }
    >
      <div className={s.ability}>
        <Avatar skin={skin} size={3.1} />
        <span className={s.abilityText}>
          <span className={s.abilityName}>{ability}</span>
          <span className={s.abilityNote}>{abilityNote}</span>
        </span>
      </div>

      <div className={s.speed}>
        <span className={s.speedLabel}>TOP SPEED</span>
        <span className={s.speedValue} data-df-numeric>{topSpeed}<span className={s.speedUnit}> m/s</span></span>
      </div>

      <div className={s.subject}>
        <span className={s.subjectCaption}>3D CHARACTER<br />SPRINT LEAN</span>
      </div>

      <span className={s.state}><BoltIcon />{state}</span>

      <div className={s.charge}>
        <span className={s.halo} />
        <div className={s.chargeCard}>
          <div className={s.chargeHead}>
            <span className={s.chargeLabel}>DASH CHARGE</span>
            <span className={s.chargeKey}>HOLD SHIFT</span>
          </div>
          <div className={s.pips}>
            {Array.from({ length: max }, (_, i) => (
              <span key={i} className={[s.pip, i < charges && s.pipOn].filter(Boolean).join(' ')} />
            ))}
          </div>
          <span className={s.recharge}>RECHARGES IN {rechargeIn}</span>
        </div>
      </div>

      <p className={s.feed}>GAMEPLAY FEED · DASH BURST</p>
    </Stage>
  );
}
