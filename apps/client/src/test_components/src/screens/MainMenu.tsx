import Stage from '../ui/Stage';
import JellyButton from '../ui/JellyButton';
import Logo from '../ui/Logo';
import Avatar from '../ui/Avatar';
import RenderSlot from '../ui/RenderSlot';
import { StatTile } from '../ui/Pill';
import type { Feel } from '../tokens';
import s from './MainMenu.module.css';

export type MenuDestination =
  | 'settings' | 'survival' | 'build' | 'discover' | 'leaderboards' | 'collection';

export interface MainMenuProps {
  playerName?: string;
  level?: number;
  online?: string;
  onPlay?: () => void;
  onNavigate?: (to: MenuDestination) => void;
  feel?: Feel;
}

const NAV: Array<[string, MenuDestination]> = [
  ['DISCOVER', 'discover'],
  ['LEADERBOARDS', 'leaderboards'],
  ['COLLECTION', 'collection'],
];

export default function MainMenu({
  playerName = 'NOODLEBEAN', level = 42, online = '3 244', onPlay, onNavigate, feel,
}: MainMenuProps) {
  return (
    <Stage
      background="var(--df-stage-menu)"
      sheen="var(--df-sheen-menu)"
      feel={feel}
      className={s.screen}
    >
      <header className={s.header}>
        <div className={s.identity}>
          <Logo size={2.65} chrome />
        </div>

        <div className={s.identity}>
          <div className={s.account}>
            <Avatar skin="pink" />
            <span className={s.accountText}>
              <span className={s.name}>{playerName}</span>
              <span className={s.level}>LEVEL {level}</span>
            </span>
          </div>
          <button type="button" className={s.iconBtn} aria-label="Settings" onClick={() => onNavigate?.('settings')}>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="10" cy="10" r="3" />
              <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M15.7 4.3l-1.4 1.4M5.7 14.3l-1.4 1.4" />
            </svg>
          </button>
        </div>
      </header>

      <div className={s.body}>
        <div className={s.actions}>
          <JellyButton feel={feel} kicker={`QUICK MATCH · ${online} BEANS ONLINE`} onClick={onPlay}>PLAY</JellyButton>

          <div className={s.modes}>
            <JellyButton
              variant="tile" tone="danger" sub="LAST BEAN STANDING"
              onClick={() => onNavigate?.('survival')}
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" /></svg>}
            >SURVIVAL</JellyButton>

            <JellyButton
              variant="tile" tone="go" sub="4 DRAFT TRACKS"
              onClick={() => onNavigate?.('build')}
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><rect x="3" y="3" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="2" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="2" /><path d="M17.25 14v6M14.25 17h6" /></svg>}
            >BUILD</JellyButton>
          </div>

          <nav className={s.nav}>
            {NAV.map(([label, dest]) => (
              <JellyButton key={dest} variant="pill" tone="glass" centered onClick={() => onNavigate?.(dest)}>
                {label}
              </JellyButton>
            ))}
          </nav>
        </div>

        <RenderSlot grounded wobble sub="IDLE + WIN POSE LOOP" className={s.hero} />
      </div>

      <div className={s.stats}>
        <StatTile label="BEST SURVIVAL" value="06:11" />
        <StatTile label="WINS" value="137" />
        <StatTile label="GRABS BROKEN" value="892" accent />
      </div>
    </Stage>
  );
}
