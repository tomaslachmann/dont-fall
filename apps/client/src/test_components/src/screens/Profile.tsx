import Stage from '../ui/Stage';
import Panel from '../ui/Panel';
import JellyButton from '../ui/JellyButton';
import Chip from '../ui/Chip';
import type { Feel } from '../tokens';
import s from './Profile.module.css';

export interface MatchRow {
  rank: number;
  track: string;
  points: number;
  when: string;
}

export interface ProfileProps {
  name?: string;
  level?: number;
  season?: string;
  xp?: number;
  xpTarget?: number;
  stats?: Array<{ label: string; value: string; hero?: boolean; accent?: boolean }>;
  badgesEarned?: number;
  badgesTotal?: number;
  matches?: MatchRow[];
  onBack?: () => void;
  feel?: Feel;
}

const STATS = [
  { label: 'CROWNS', value: '137', hero: true },
  { label: 'MATCHES', value: '1 042' },
  { label: 'WIN RATE', value: '13%', accent: true },
  { label: 'GRABS BROKEN', value: '892' },
];

const MATCHES: MatchRow[] = [
  { rank: 1, track: 'THE BIG WOBBLE · RACE', points: 520, when: '18 MIN AGO' },
  { rank: 2, track: 'JELLY GAUNTLET · SURVIVAL', points: 495, when: '1 H AGO' },
  { rank: 7, track: 'SLIP CITY LOOP · RACE', points: 180, when: 'YESTERDAY' },
];

const LockIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
);

export default function Profile({
  name = 'NOODLEBEAN', level = 43, season = 'SINCE S1', xp = 1240, xpTarget = 4000,
  stats = STATS, badgesEarned = 14, badgesTotal = 60, matches = MATCHES, onBack, feel,
}: ProfileProps) {
  const locked = 5;

  return (
    <Stage background="var(--df-stage-lobby)" sheen="var(--df-sheen-menu)" feel={feel} className={s.screen}>
      <div className={s.topbar}>
        <div className={s.crumb}>
          <button type="button" className={s.back} onClick={onBack} aria-label="Back">
            <svg viewBox="0 0 18 18"><path d="M11 3L5 9l6 6" /></svg>
          </button>
          <span className={s.title}>PROFILE</span>
        </div>
        <div className={s.topActions}>
          <JellyButton variant="pill" tone="glass" centered feel={feel}>SHARE CARD</JellyButton>
          <Chip tone="plate" lg>EDIT BEAN</Chip>
        </div>
      </div>

      <Panel className={s.card}>
        <span className={s.render}>
          <span className={s.renderCaption}>3D CHARACTER RENDER<br />SIGNATURE VICTORY POSE</span>
        </span>
        <span className={s.name}>{name}</span>
        <span className={s.tags}>
          <Chip tone="any">LEVEL {level}</Chip>
          <Chip tone="waiting">{season}</Chip>
        </span>
        <span className={s.xpTrack}><span className={s.xpFill} style={{ width: `${(xp / xpTarget) * 100}%` }} /></span>
        <span className={s.xpNote} data-df-numeric>
          {xp.toLocaleString('en-US').replace(/,/g, ' ')} / {xpTarget.toLocaleString('en-US').replace(/,/g, ' ')} XP TO LEVEL {level + 1}
        </span>
      </Panel>

      <div className={s.right}>
        <div className={s.stats}>
          {stats.map((st) => (
            <div key={st.label} className={[s.stat, st.hero && s.statHero].filter(Boolean).join(' ')}>
              <span className={s.statLabel}>{st.label}</span>
              <span className={[s.statValue, st.accent && s.statAccent].filter(Boolean).join(' ')} data-df-numeric>{st.value}</span>
            </div>
          ))}
        </div>

        <div className={s.badges}>
          <div className={s.badgeHead}>
            <span className={s.badgeTitle}>BADGES</span>
            <span className={s.badgeCount}>{badgesEarned} OF {badgesTotal}</span>
          </div>
          <div className={s.badgeGrid}>
            <span className={[s.badge, s.badgeGold].join(' ')}>1</span>
            <span className={[s.badge, s.badgePink].join(' ')}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4H4v16h4M16 4h4v16h-4" /><circle cx="12" cy="12" r="2.5" /></svg>
            </span>
            <span className={[s.badge, s.badgeMint].join(' ')}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 3v5h-5" /></svg>
            </span>
            <span className={[s.badge, s.badgeCyan].join(' ')}>
              <svg viewBox="0 0 30 26" aria-hidden="true"><path d="M0 13h13L8 0l14 13-13 0 5 13z" /></svg>
            </span>
            {Array.from({ length: locked }, (_, i) => (
              <span key={i} className={s.badge}><LockIcon /></span>
            ))}
            <span className={[s.badge, s.badgeMore].join(' ')}>+{badgesTotal - badgesEarned - locked - 4}</span>
          </div>
        </div>

        <Panel className={s.recent}>
          <div className={s.recentHead}>
            <span className={s.recentTitle}>RECENT MATCHES</span>
            <button type="button" className={s.seeAll}>SEE ALL</button>
          </div>
          <div className={s.matches}>
            {matches.map((m) => (
              <div key={m.track} className={[s.match, m.rank === 1 && s.won].filter(Boolean).join(' ')}>
                <span className={s.matchRank}>{m.rank}</span>
                <span className={s.matchName}>{m.track}</span>
                <span className={s.matchMeta} data-df-numeric>{m.points} PTS</span>
                <span className={s.matchMeta}>{m.when}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </Stage>
  );
}
