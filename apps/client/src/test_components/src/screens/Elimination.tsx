import Stage from '../ui/Stage';
import Panel from '../ui/Panel';
import JellyButton from '../ui/JellyButton';
import type { Feel } from '../tokens';
import s from './Elimination.module.css';

export interface EliminationProps {
  verdict?: string;
  survived?: string;
  position?: string;
  grabsBroken?: number;
  beansLeft?: number;
  onRetry?: () => void;
  onSpectate?: () => void;
  onExit?: () => void;
  feel?: Feel;
}

const RetryIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
    <path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 3v5h-5" />
  </svg>
);

export default function Elimination({
  verdict = 'SO CLOSE', survived = '04:32', position = '#4',
  grabsBroken = 6, beansLeft = 3, onRetry, onSpectate, onExit, feel,
}: EliminationProps) {
  return (
    <Stage
      background="var(--df-stage-race)"
      field="var(--df-field-race)"
      feel={feel}
      className={s.screen}
      overlay={<div className={s.dim} />}
    >
      <Panel className={s.card}>
        <span className={s.badge}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" /></svg>
          KNOCKED OUT
        </span>

        <span className={s.verdict}>{verdict}</span>

        <div className={s.stats}>
          <span className={s.stat}>
            <span className={s.statLabel}>SURVIVED</span>
            <span className={s.statValue} data-df-numeric>{survived}</span>
          </span>
          <span className={s.stat}>
            <span className={s.statLabel}>POSITION</span>
            <span className={[s.statValue, s.statBrand].join(' ')}>{position}</span>
          </span>
          <span className={[s.stat, s.statGold].join(' ')}>
            <span className={s.statLabel}>GRABS BROKEN</span>
            <span className={[s.statValue, s.statGoldValue].join(' ')} data-df-numeric>{grabsBroken}</span>
          </span>
          <span className={s.stat}>
            <span className={s.statLabel}>BEANS LEFT</span>
            <span className={s.statValue} data-df-numeric>{beansLeft}</span>
          </span>
        </div>

        <div className={s.actions}>
          <JellyButton variant="tile" tone="go" centered feel={feel} onClick={onRetry} icon={<RetryIcon />}>RETRY</JellyButton>
          <JellyButton variant="pill" tone="glass" centered feel={feel} onClick={onSpectate}>SPECTATE</JellyButton>
          <JellyButton variant="pill" tone="glass" centered feel={feel} onClick={onExit}>EXIT</JellyButton>
        </div>
      </Panel>
    </Stage>
  );
}
