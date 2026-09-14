import Stage from '../ui/Stage';
import JellyButton from '../ui/JellyButton';
import Logo from '../ui/Logo';
import Avatar from '../ui/Avatar';
import { StatTile } from '../ui/Pill';
import type { Feel } from '../tokens';
import s from './FriendRequestAlert.module.css';

export interface FriendRequestAlertProps {
  playerName?: string;
  level?: number;
  pending?: number;
  online?: string;
  requestFrom?: string;
  inviteFrom?: string;
  inviteSlots?: number;
  feel?: Feel;
}

const TickIcon = () => <svg viewBox="0 0 16 13" aria-hidden="true"><path d="M1.5 6.5l4.5 4.5L14.5 2" /></svg>;
const CrossIcon = () => <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2 2l10 10M12 2L2 12" /></svg>;

export default function FriendRequestAlert({
  playerName = 'NOODLEBEAN', level = 43, pending = 3, online = '3 244',
  requestFrom = 'GOOPY', inviteFrom = 'FLOPPO', inviteSlots = 3, feel,
}: FriendRequestAlertProps) {
  return (
    <Stage background="var(--df-stage-menu)" sheen="var(--df-sheen-menu)" feel={feel} className={s.screen}>
      <header className={s.header}>
        <Logo size={2.65} chrome />

        <div className={s.identity}>
          <div className={s.account}>
            <Avatar skin="pink" />
            <span className={s.accountText}>
              <span className={s.name}>{playerName}</span>
              <span className={s.level}>LEVEL {level}</span>
            </span>
            <span className={s.badge}>{pending}</span>
          </div>
          <button type="button" className={s.iconBtn} aria-label="Settings">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="10" cy="10" r="3" />
              <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M15.7 4.3l-1.4 1.4M5.7 14.3l-1.4 1.4" />
            </svg>
          </button>
        </div>
      </header>

      <div className={s.body}>
        <div className={s.actions}>
          <JellyButton feel={feel} kicker={`QUICK MATCH · ${online} BEANS ONLINE`}>PLAY</JellyButton>

          <nav className={s.nav}>
            <span className={s.navItem}>
              <JellyButton variant="pill" tone="glass" centered feel={feel}>FRIENDS</JellyButton>
              <span className={[s.badge, s.badgeSmall].join(' ')}>{pending}</span>
            </span>
            <JellyButton variant="pill" tone="glass" centered feel={feel}>DISCOVER</JellyButton>
            <JellyButton variant="pill" tone="glass" centered feel={feel}>COLLECTION</JellyButton>
          </nav>
        </div>

        <div className={s.toasts}>
          <div className={s.toast}>
            <Avatar skin="mint" size={3.75} />
            <span className={s.toastText}>
              <span className={s.toastKicker}>FRIEND REQUEST</span>
              <span className={s.toastTitle}>{requestFrom} WANTS IN</span>
            </span>
            <span className={s.toastActions}>
              <button type="button" className={[s.action, s.accept].join(' ')} aria-label="Accept"><TickIcon /></button>
              <button type="button" className={[s.action, s.decline].join(' ')} aria-label="Decline"><CrossIcon /></button>
            </span>
          </div>

          <div className={[s.toast, s.toastDark].join(' ')}>
            <Avatar skin="cyan" size={3.1} />
            <span className={s.toastText}>
              <span className={s.toastKicker}>LOBBY INVITE</span>
              <span className={s.toastTitle}>{inviteFrom} · {inviteSlots} SLOTS OPEN</span>
            </span>
            <JellyButton variant="pill" centered feel={feel}>JOIN</JellyButton>
          </div>
        </div>
      </div>

      <div className={s.stats}>
        <StatTile label="WINS" value="137" />
        <StatTile label="FRIENDS ONLINE" value="12" accent />
      </div>
    </Stage>
  );
}
