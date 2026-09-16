import Stage from '../ui/Stage';
import JellyButton from '../ui/JellyButton';
import Avatar from '../ui/Avatar';
import type { Skin } from '../ui/Avatar';
import type { Feel } from '../tokens';
import { CharacterPreview, SHRUG_SEQUENCE, SULK_SEQUENCE, WIN_SEQUENCE, type PreviewAnimation } from './CharacterPreview.js';
import s from './MatchOver.module.css';

export interface PodiumPlace {
  name: string;
  points: number;
  /** What the render is doing on this plinth. */
  pose: string;
  /** Equipped skin at Match end — null for anonymous seats: the default. */
  skin?: number | null;
}

/** The performance is positional: 1st celebrates, 2nd sulks, 3rd shrugs. Anything past that idles. */
const performanceForPlace = (index: number): PreviewAnimation =>
  index === 0 ? WIN_SEQUENCE : index === 1 ? SULK_SEQUENCE : index === 2 ? SHRUG_SEQUENCE : "Idle";

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

/** One plinth. 1st renders taller and in accent. The bean faces front — a celebration reads to the viewer, not around a turntable. */
function Place({ place, rank, index, first }: { place: PodiumPlace; rank: string; index: number; first?: boolean }) {
  return (
    <div className={[s.place, first && s.first].filter(Boolean).join(' ')}>
      <CharacterPreview
        skin={place.skin ?? null}
        animation={performanceForPlace(index)}
        autoRotate={false}
        sub={place.pose}
        canvasLabel={`3D preview of ${place.name}`}
        className={s.render}
      />
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
        {second && <Place place={second} rank="2ND" index={1} />}
        <Place place={first} rank="1ST" index={0} first />
        {third && <Place place={third} rank="3RD" index={2} />}
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
