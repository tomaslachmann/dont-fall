import { useState } from 'react';
import Stage from '../ui/Stage';
import Panel from '../ui/Panel';
import JellyButton from '../ui/JellyButton';
import Avatar from '../ui/Avatar';
import type { Skin } from '../ui/Avatar';
import Chip from '../ui/Chip';
import ReadySwitch from '../ui/ReadySwitch';
import type { Feel } from '../tokens';
import s from './BetweenRounds.module.css';

export interface StandingRow {
  name: string;
  skin: Skin;
  /** Points earned this round. */
  gained: number;
  total: number;
  /** Places moved since last round. Positive = climbed. */
  moved?: number;
  you?: boolean;
  out?: boolean;
}

export interface BetweenRoundsProps {
  round?: number;
  rounds?: number;
  justPlayed?: string;
  standings?: StandingRow[];
  nextTrack?: string;
  nextNote?: string;
  autoStart?: string;
  onScoreboard?: () => void;
  onLeave?: () => void;
  feel?: Feel;
}

const STANDINGS: StandingRow[] = [
  { name: 'GOOPY', skin: 'mint', gained: 180, total: 340, moved: 2 },
  { name: 'NOODLEBEAN', skin: 'pink', gained: 140, total: 315, moved: -1, you: true },
  { name: 'FLOPPO', skin: 'cyan', gained: 120, total: 280 },
  { name: 'SPLATTO', skin: 'gold', gained: 90, total: 205 },
  { name: 'BONK', skin: 'pink', gained: 60, total: 150 },
  { name: 'MRBEANO', skin: 'grape', gained: 40, total: 95, out: true },
];

export default function BetweenRounds({
  round = 2, rounds = 3, justPlayed = 'JELLY GAUNTLET · SURVIVAL',
  standings = STANDINGS, nextTrack = 'THE BIG WOBBLE',
  nextNote = 'Final round pays double. 25 points behind is nothing.',
  autoStart = '0:14', onScoreboard, onLeave, feel,
}: BetweenRoundsProps) {
  const [ready, setReady] = useState(false);
  const readyCount = 5;

  return (
    <Stage background="var(--df-stage-lobby)" sheen="var(--df-sheen-menu)" feel={feel} className={s.screen}>
      <div className={s.topbar}>
        <div className={s.heading}>
          <span className={s.title}>ROUND {round} DONE</span>
          <span className={s.progress}>
            {Array.from({ length: rounds }, (_, i) => (
              <span key={i} className={[s.step, i < round && s.stepDone].filter(Boolean).join(' ')} />
            ))}
          </span>
          <span className={s.left}>{rounds - round === 1 ? 'ONE ROUND LEFT' : `${rounds - round} ROUNDS LEFT`}</span>
        </div>
        <Chip tone="plate" lg>{justPlayed}</Chip>
      </div>

      <Panel className={s.table}>
        <div className={s.tableHead}>
          <span className={s.tableTitle}>POINTS</span>
          <span className={s.colLabel}>THIS ROUND</span>
          <span className={[s.colLabel, s.colTotal].join(' ')}>TOTAL</span>
        </div>

        <div className={s.rows}>
          {standings.map((p, i) => (
            <div
              key={p.name}
              className={[s.row, p.you && s.you, p.out && s.eliminated].filter(Boolean).join(' ')}
            >
              <span className={s.rank}>{i + 1}</span>
              <Avatar skin={p.skin} size={3.1} ring={p.you ? 'var(--df-color-accent)' : undefined} />
              <span className={s.name}>
                <span className={s.nameText}>{p.name}</span>
                {p.you && <span className={s.tagYou}>YOU</span>}
              </span>
              <span className={[s.move, p.moved && p.moved > 0 ? s.moveUp : s.moveDown].filter(Boolean).join(' ')}>
                {p.moved ? (
                  <>
                    <svg viewBox="0 0 10 9" fill="currentColor" aria-hidden="true">
                      <path d={p.moved > 0 ? 'M5 0l5 9H0z' : 'M5 9L0 0h10z'} />
                    </svg>
                    <span className={s.moveVal}>{Math.abs(p.moved)}</span>
                  </>
                ) : null}
              </span>
              <span className={s.gain} data-df-numeric>+{p.gained}</span>
              <span className={s.total} data-df-numeric>{p.total}</span>
            </div>
          ))}
        </div>
      </Panel>

      <div className={s.next}>
        <span className={s.nextKicker}>NEXT UP · ROUND {round + 1}</span>
        <span
          className={s.nextThumb}
          style={{ background: 'repeating-linear-gradient(115deg,#FFC9E4 0 calc(var(--df-u) * .95),#FFB4DC calc(var(--df-u) * .95) calc(var(--df-u) * 1.9))' }}
        >EXISTING TRACK<br />THUMBNAIL</span>
        <span className={s.nextName}>{nextTrack}</span>
        <span className={s.nextTags}>
          <Chip tone="race">RACE</Chip>
          <Chip tone="glass">DOUBLE POINTS</Chip>
        </span>
        <span className={s.nextNote}>{nextNote}</span>
      </div>

      <div className={s.foot}>
        <ReadySwitch
          ready={ready}
          onChange={setReady}
          label="READY"
          tally={`${readyCount} OF ${standings.length} READY`}
          hint={`AUTO-START IN ${autoStart}`}
        />
      </div>

      <div className={s.footActions}>
        <JellyButton variant="pill" tone="glass" centered feel={feel} onClick={onScoreboard}>SCOREBOARD</JellyButton>
        <JellyButton variant="pill" tone="glass" centered feel={feel} onClick={onLeave}>LEAVE MATCH</JellyButton>
      </div>
    </Stage>
  );
}
