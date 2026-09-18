import s from './Vignette.module.css';

/** Closing-in danger at the edges (survival endgame, being grabbed). */
export function Danger({ pulse = true }: { pulse?: boolean }) {
  return (
    <div className={s.layer}>
      <div className={[s.danger, pulse && s.pulsing].filter(Boolean).join(' ')} />
    </div>
  );
}
