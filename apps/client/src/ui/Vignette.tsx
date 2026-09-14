import type { CSSProperties } from 'react';
import s from './Vignette.module.css';

const delay = (n: number) => ({ '--df-fx-delay': `${n}s` } as CSSProperties);

/** Closing-in danger at the edges (survival endgame, being grabbed). */
export function Danger({ pulse = true }: { pulse?: boolean }) {
  return (
    <div className={s.layer}>
      <div className={[s.danger, pulse && s.pulsing].filter(Boolean).join(' ')} />
    </div>
  );
}

/** HIT: black snap, then red bleed from the edges. */
export function HitFlash() {
  return (
    <div className={s.layer}>
      <div className={s.hitBlack} />
      <div className={s.hitRed} />
    </div>
  );
}

/** Which way the damage came from. 0deg = from the right. */
export function HitWedge({ angle = 0 }: { angle?: number }) {
  return (
    <div className={s.layer}>
      <div className={s.wedgeWrap} style={{ '--df-hit-angle': `${angle}deg` } as CSSProperties}>
        <div className={s.wedge} />
      </div>
    </div>
  );
}

/** DASH: wind wrapping the character plus an FOV push. */
export function DashWind() {
  return (
    <div className={s.layer}>
      <div className={s.fov} />
      <div className={s.trails}>
        {[0, 0.18, 0.36, 0.54, 0.72].map((d) => <span key={d} className={s.trail} style={delay(d)} />)}
      </div>
      <div className={s.arcs}>
        {[0, 0.25, 0.5].map((d) => <span key={d} className={s.arc} style={delay(d)} />)}
      </div>
    </div>
  );
}

/** RAGDOLL: dust puffs off the floor. */
export function Dust() {
  return (
    <div className={s.layer}>
      {[0, 0.3, 0.6].map((d) => (
        <div key={d} className={s.dust}><span className={s.puff} style={delay(d)} /></div>
      ))}
    </div>
  );
}
