import type { Leaderboard, LeaderboardBoard, LeaderboardRow } from '@dont-fall/shared';
import Stage from '../ui/Stage';
import Panel from '../ui/Panel';
import JellyButton from '../ui/JellyButton';
import Avatar from '../ui/Avatar';
import { avatarLook } from '../lib/avatar.js';
import { formatRaceTime, formatStay } from '../lib/utils/roundTimer.js';
import s from './Leaderboards.module.css';

const BOARDS: Array<[LeaderboardBoard, string, string]> = [
  ['wins', 'WINS', 'MATCHES WON'],
  ['race', 'RACE TIMES', 'BEST TIME'],
  ['survival', 'SURVIVAL', 'LONGEST STAY'],
];

/** A board's number as its column shows it. */
const shown = (board: LeaderboardBoard, value: number): string =>
  board === 'wins' ? String(value) : board === 'race' ? formatRaceTime(value) : formatStay(value);

export interface LeaderboardsProps {
  board: LeaderboardBoard;
  onBoard: (board: LeaderboardBoard) => void;
  /** The Race board's Track, named — `null` when there is no raceable Track at all. */
  trackName: string | null;
  /** Walks the Race board's Tracks — absent with fewer than two to walk. */
  onTrack?: ((step: -1 | 1) => void) | undefined;
  data: Leaderboard | null;
  onBack: () => void;
}

/**
 * Leaderboards (ADR 0110): three boards the user picked — Matches won, the
 * best time on each Race Track, the longest stay in a Survival Round. The
 * design has no screen for it, so it is composed from its pieces: the
 * Scoreboard's table, the Friends screen's tabs, the Lobby's pill pair.
 */
export default function Leaderboards({ board, onBoard, trackName, onTrack, data, onBack }: LeaderboardsProps) {
  const label = BOARDS.find(([key]) => key === board)![2];
  const you = data?.you ?? null;
  const youShown = you !== null && data!.rows.some((row) => row.accountId === you.accountId);
  const line = (row: LeaderboardRow, isYou: boolean) => (
    <div key={`${row.accountId}-${isYou}`} className={[s.row, isYou && s.you].filter(Boolean).join(' ')}>
      <span className={s.rank}>{row.rank}</span>
      <Avatar look={avatarLook(row.accountId, row.color)} size={3.1} ring={isYou ? 'var(--df-color-accent)' : undefined} />
      <span className={s.name}>
        <span className={s.nameText}>{row.displayName}</span>
        {isYou && <span className={s.tagYou}>YOU</span>}
      </span>
      <span className={s.value} data-df-numeric>{shown(board, row.value)}</span>
    </div>
  );
  return (
    <Stage background="var(--df-stage-lobby)" sheen="var(--df-sheen-menu)" className={s.screen}>
      <div className={s.topbar}>
        <span className={s.title}>LEADERBOARDS</span>
      </div>

      <div className={s.tabs} role="tablist" aria-label="Board">
        {BOARDS.map(([key, name]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={key === board}
            className={[s.tab, key === board && s.tabOn].filter(Boolean).join(' ')}
            onClick={() => onBoard(key)}
          >{name}</button>
        ))}
        {board === 'race' && trackName !== null && (
          <span className={s.track}>
            {onTrack && <JellyButton variant="pill" tone="glass" centered onClick={() => onTrack(-1)}>PREV</JellyButton>}
            <span className={s.trackName}>{trackName}</span>
            {onTrack && <JellyButton variant="pill" tone="glass" centered onClick={() => onTrack(1)}>NEXT</JellyButton>}
          </span>
        )}
      </div>

      <Panel className={s.table}>
        <div className={s.tableHead}>
          <span className={s.tableTitle}>TOP {data?.rows.length ?? 0}</span>
          <span className={s.colLabel}>{label}</span>
        </div>
        <div className={s.rows}>
          {data !== null && data.rows.length === 0 && (
            <p className={s.empty}>{board === 'race' && trackName === null ? 'NO RACE TRACKS YET' : 'NOBODY ON THIS BOARD YET'}</p>
          )}
          {data?.rows.map((row) => line(row, row.accountId === you?.accountId))}
          {you !== null && !youShown && <div className={s.gap}>{line(you, true)}</div>}
        </div>
      </Panel>

      <div className={s.actions}>
        <JellyButton variant="pill" tone="glass" centered sound="back" onClick={onBack}>BACK</JellyButton>
      </div>
    </Stage>
  );
}
