import Stage from '../ui/Stage';
import Panel from '../ui/Panel';
import JellyButton from '../ui/JellyButton';
import Avatar from '../ui/Avatar';
import type { StandingRowView } from '../lib/matchView.js';
import s from './Scoreboard.module.css';

export interface ScoreboardProps {
  title?: string;
  rows?: StandingRowView[];
  onBack?: () => void;
}

/**
 * The full table behind both SCOREBOARD buttons (BetweenRounds, MatchOver)
 * — every ranked Player with this-Round gain and Match total, not just the
 * podium. Rows arrive via route state (the same `StandingRowView` the
 * overlay already built), so this renders data, never refetches it.
 */
export default function Scoreboard({ title = 'STANDINGS', rows = [], onBack }: ScoreboardProps) {
  return (
    <Stage background="var(--df-stage-lobby)" sheen="var(--df-sheen-menu)" className={s.screen}>
      <div className={s.topbar}>
        <span className={s.title}>{title}</span>
      </div>

      <Panel className={s.table}>
        <div className={s.tableHead}>
          <span className={s.tableTitle}>POINTS</span>
          <span className={s.colLabel}>THIS ROUND</span>
          <span className={[s.colLabel, s.colTotal].join(' ')}>TOTAL</span>
        </div>

        <div className={s.rows}>
          {rows.map((p, i) => (
            <div key={p.name} className={[s.row, p.you && s.you, p.out && s.eliminated].filter(Boolean).join(' ')}>
              <span className={s.rank}>{i + 1}</span>
              <Avatar skin={p.skin} size={3.1} ring={p.you ? 'var(--df-color-accent)' : undefined} />
              <span className={s.name}>
                <span className={s.nameText}>{p.name}</span>
                {p.you && <span className={s.tagYou}>YOU</span>}
              </span>
              <span className={s.gain} data-df-numeric>+{p.gained}</span>
              <span className={s.total} data-df-numeric>{p.total}</span>
            </div>
          ))}
        </div>
      </Panel>

      <div className={s.actions}>
        <JellyButton variant="pill" tone="glass" centered onClick={onBack}>BACK</JellyButton>
      </div>
    </Stage>
  );
}
