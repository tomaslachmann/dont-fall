import Stage from '../ui/Stage';
import JellyButton from '../ui/JellyButton';
import Avatar from '../ui/Avatar';
import type { Skin } from '../ui/Avatar';
import type { Feel } from '../tokens';
import s from './MatchOver.module.css';

export interface PodiumPlace {
  name: string;
  points: number;
  /** What the render is doing on this plinth. */
  pose: string;
}

export interface MatchOverProps {
  /** Finishing order, at least 1st — the podium renders only the places present, so a two-Player Match simply has no 3rd. */
  podium?: [PodiumPlace, ...PodiumPlace[]];
  rounds?: number;
  you?: { place: string; points: number; skin: Skin };
  stats?: Array<[string, string]>;
  gapNote?: string;
  /** This viewer never raced (ADR 0059) — no "you" line to show and no claim rows to bank, so both hide. */
  spectator?: boolean;
  onCollect?: () => void;
  onScoreboard?: () => void;
  onSkip?: () => void;
  feel?: Feel;
}

const PODIUM: [PodiumPlace, PodiumPlace, PodiumPlace] = [
  { name: 'GOOPY', points: 520, pose: 'WINNER CELEBRATION LOOP' },
  { name: 'NOODLEBEAN', points: 495, pose: 'SULK POSE' },
  { name: 'FLOPPO', points: 400, pose: 'SHRUG POSE' },
];

const STATS: Array<[string, string]> = [
  ['ROUND WINS', '1'],
  ['GRABS BROKEN', '6'],
  ['LONGEST SURVIVAL', '05:07'],
];

/** One plinth. 1st renders taller and in accent. */
function Place({ place, rank, first }: { place: PodiumPlace; rank: string; first?: boolean }) {
  return (
    <div className={[s.place, first && s.first].filter(Boolean).join(' ')}>
      <span className={s.render}>
        <span className={s.renderCaption}>3D CHARACTER RENDER<br />{place.pose}</span>
      </span>
      <span className={s.rank}>{rank}</span>
      <span className={s.name}>{place.name}</span>
      <span className={s.score} data-df-numeric>{place.points}</span>
    </div>
  );
}

export default function MatchOver({
  podium = PODIUM, rounds = 3,
  you = { place: '2ND', points: 495, skin: 'pink' },
  stats = STATS, gapNote = '25 POINTS OFF THE CROWN',
  spectator = false,
  onCollect, onScoreboard, onSkip, feel,
}: MatchOverProps) {
  const [first, second, third] = podium;

  return (
    <Stage background="var(--df-stage-victory)" sheen="var(--df-sheen-top)" feel={feel} className={s.screen}>
      <div className={s.headline}>
        <span className={s.kicker}>MOST POINTS WINS · {rounds} ROUNDS</span>
        <span className={s.title}>{first.name} TAKES THE CROWN</span>
      </div>

      <div className={[s.podium, podium.length === 1 && s.one, podium.length === 2 && s.two].filter(Boolean).join(' ')}>
        {second && <Place place={second} rank="2ND" />}
        <Place place={first} rank="1ST" first />
        {third && <Place place={third} rank="3RD" />}
      </div>

      {!spectator && (
        <div className={s.yourRun}>
          <span className={s.you}>
            <Avatar skin={you.skin} size={2.65} />
            <span className={s.youText}>YOU FINISHED {you.place} · {you.points} PTS</span>
          </span>
          <span className={s.sep} />
          {stats.map(([label, value]) => (
            <span key={label} className={s.stat}>{label} <span className={s.statValue} data-df-numeric>{value}</span></span>
          ))}
          <span className={s.gap}>{gapNote}</span>
        </div>
      )}

      <div className={s.actions}>
        {!spectator && <JellyButton variant="tile" centered onClick={onCollect}>COLLECT REWARDS</JellyButton>}
        <JellyButton variant="pill" tone="glass" centered onClick={onScoreboard}>FULL SCOREBOARD</JellyButton>
        <JellyButton variant="pill" tone="glass" centered onClick={onSkip}>SKIP</JellyButton>
      </div>
    </Stage>
  );
}
