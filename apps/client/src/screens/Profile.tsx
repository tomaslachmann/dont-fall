import Stage from '../ui/Stage';
import Panel from '../ui/Panel';
import JellyButton from '../ui/JellyButton';
import Chip from '../ui/Chip';
import type { Feel } from '../tokens';
import { CharacterPreview, WIN_SEQUENCE } from './CharacterPreview.js';
import s from './Profile.module.css';

export interface MatchRow {
  rank: number;
  track: string;
  points: number;
  when: string;
}

export interface ProfileStat {
  label: string;
  value: string;
  hero?: boolean;
  accent?: boolean;
}

export interface ProfileProps {
  name?: string;
  /** Whose card this is — the render wears their skin, or the default while unknown. */
  skin?: number | null;
  /** And their hat (ADR 0083), or none. */
  hat?: string | null;
  level?: number;
  /** No season system exists, so the Route passes none and the chip hides. */
  season?: string;
  /** XP into the current level. */
  xp?: number;
  /** XP span to leave it. */
  xpTarget?: number;
  /** Null while the career loads — the section says so instead of faking numbers. */
  stats?: ProfileStat[] | null;
  /** Null while the career loads — same loading state. */
  badges?: { earned: number; total: number } | null;
  /** Earned badge names in tile order — what each numbered tile's tooltip says. */
  badgeNames?: string[];
  /** Null while the career loads; an empty list is a career with no finished Matches yet. */
  matches?: MatchRow[] | null;
  /** The career fetch failed — every section says so. */
  failed?: boolean;
  onBack?: () => void;
  onShare?: () => void;
  onEditBean?: () => void;
  onSeeAll?: () => void;
  /** The history toggle's label — "SEE ALL" collapsed, "SHOW LESS" expanded. */
  seeAllLabel?: string;
  feel?: Feel;
}

const LockIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
);

export default function Profile({
  name = 'BEAN', skin = null, hat = null, level = 1, season, xp = 0, xpTarget = 1000,
  stats = null, badges = null, badgeNames = [], matches = null, failed = false,
  onBack, onShare, onEditBean, onSeeAll, seeAllLabel = 'SEE ALL', feel,
}: ProfileProps) {
  // Earned tiles first (numbered — no badge catalog exists to picture them),
  // locks for the visible rest, one overflow tile for everything past nine.
  const earnedShown = badges === null ? 0 : Math.min(badges.earned, 4);
  const locksShown = badges === null ? 0 : Math.min(Math.max(badges.total - badges.earned, 0), 5);
  const overflow = badges === null ? 0 : badges.total - earnedShown - locksShown;

  return (
    <Stage background="var(--df-stage-lobby)" sheen="var(--df-sheen-menu)" feel={feel} className={s.screen}>
      <div className={s.topbar}>
        <div className={s.crumb}>
          <button type="button" className={s.back} data-ui-sound="back" onClick={onBack} aria-label="Back">
            <svg viewBox="0 0 18 18"><path d="M11 3L5 9l6 6" /></svg>
          </button>
          <span className={s.title}>PROFILE</span>
        </div>
        <div className={s.topActions}>
          <JellyButton variant="pill" tone="glass" centered onClick={onShare}>SHARE CARD</JellyButton>
          <JellyButton variant="pill" tone="ink" centered onClick={onEditBean}>EDIT BEAN</JellyButton>
        </div>
      </div>

      <Panel className={s.card}>
        <CharacterPreview
          skin={skin}
          hat={hat}
          animation={WIN_SEQUENCE}
          autoRotate={false}
          label="3D CHARACTER RENDER"
          sub="SIGNATURE VICTORY POSE"
          canvasLabel={`3D preview of ${name}`}
          className={s.render}
        />
        <span className={s.name}>{name}</span>
        <span className={s.tags}>
          <Chip tone="any">LEVEL {level}</Chip>
          {season !== undefined && <Chip tone="waiting">{season}</Chip>}
        </span>
        {/* Divs, not spans — an inline fill ignores the percentage width entirely (the bar would never fill). */}
        <div className={s.xpTrack}>
          <div
            className={s.xpFill}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={xpTarget}
            aria-valuenow={Math.round(xp)}
            style={{ width: `${Math.min(100, Math.max(0, (xp / xpTarget) * 100))}%` }}
          />
        </div>
        <span className={s.xpNote} data-df-numeric>
          {xp.toLocaleString('en-US').replace(/,/g, ' ')} / {xpTarget.toLocaleString('en-US').replace(/,/g, ' ')} XP TO LEVEL {level + 1}
        </span>
      </Panel>

      <div className={s.right}>
        <div className={s.stats}>
          {failed ? (
            <span className={s.empty}>Couldn't load the career.</span>
          ) : stats === null ? (
            <span className={s.empty}>Loading…</span>
          ) : (
            stats.map((st) => (
              <div key={st.label} className={[s.stat, st.hero && s.statHero].filter(Boolean).join(' ')}>
                <span className={s.statLabel}>{st.label}</span>
                <span className={[s.statValue, st.accent && s.statAccent].filter(Boolean).join(' ')} data-df-numeric>{st.value}</span>
              </div>
            ))
          )}
        </div>

        <div className={s.badges}>
          {failed ? (
            <span className={s.empty}>Couldn't load the career.</span>
          ) : badges === null ? (
            <span className={s.empty}>Loading…</span>
          ) : (
            <>
              <div className={s.badgeHead}>
                <span className={s.badgeTitle}>BADGES</span>
                <span className={s.badgeCount}>{badges.earned} OF {badges.total}</span>
              </div>
              <div className={s.badgeGrid}>
                {Array.from({ length: earnedShown }, (_, i) => (
                  <span key={`earned-${i}`} className={[s.badge, s.badgeGold].join(' ')} title={badgeNames[i]}>{i + 1}</span>
                ))}
                {Array.from({ length: locksShown }, (_, i) => (
                  <span key={`locked-${i}`} className={s.badge}><LockIcon /></span>
                ))}
                {overflow > 0 && <span className={[s.badge, s.badgeMore].join(' ')}>+{overflow}</span>}
              </div>
            </>
          )}
        </div>

        <Panel className={s.recent}>
          <div className={s.recentHead}>
            <span className={s.recentTitle}>RECENT MATCHES</span>
            <button type="button" className={s.seeAll} onClick={onSeeAll}>{seeAllLabel}</button>
          </div>
          {failed ? (
            <span className={s.empty}>Couldn't load the career.</span>
          ) : matches === null ? (
            <span className={s.empty}>Loading…</span>
          ) : matches.length === 0 ? (
            <span className={s.empty}>No finished Matches yet — race one and it lands here.</span>
          ) : (
            <div className={s.matches}>
              {matches.map((m, i) => (
                // Index key: rows carry no id, and the same Track repeats —
                // `m.track` would collide on the first replay.
                <div key={i} className={[s.match, m.rank === 1 && s.won].filter(Boolean).join(' ')}>
                  <span className={s.matchRank}>{m.rank}</span>
                  <span className={s.matchName}>{m.track}</span>
                  <span className={s.matchMeta} data-df-numeric>{m.points} PTS</span>
                  <span className={s.matchMeta}>{m.when}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </Stage>
  );
}
