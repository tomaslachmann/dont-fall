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
  /** 1st, 2nd, 3rd — in finishing order. */
  podium?: [PodiumPlace, PodiumPlace, PodiumPlace];
  rounds?: number;
  you?: { place: string; points: number; skin: Skin };
  stats?: Array<[string, string]>;
  gapNote?: string;
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
  onCollect, onScoreboard, onSkip, feel,
}: MatchOverProps) {
  const [first, second, third] = podium;

  return (
    <Stage background="var(--df-stage-victory)" sheen="var(--df-sheen-top)" feel={feel} className={s.screen}>
      <div className={s.headline}>
        <span className={s.kicker}>MOST POINTS WINS · {rounds} ROUNDS</span>
        <span className={s.title}>{first.name} TAKES THE CROWN</span>
      </div>

      <div className={s.podium}>
        <Place place={second} rank="2ND" />
        <Place place={first} rank="1ST" first />
        <Place place={third} rank="3RD" />
      </div>

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

      <div className={s.actions}>
        <JellyButton variant="tile" centered feel={feel} onClick={onCollect}>COLLECT REWARDS</JellyButton>
        <JellyButton variant="pill" tone="glass" centered feel={feel} onClick={onScoreboard}>FULL SCOREBOARD</JellyButton>
        <JellyButton variant="pill" tone="glass" centered feel={feel} onClick={onSkip}>SKIP</JellyButton>
      </div>
    </Stage>
  );
}
