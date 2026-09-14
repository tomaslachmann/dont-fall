import { useState } from 'react';
import Stage from '../ui/Stage';
import JellyButton from '../ui/JellyButton';
import Logo from '../ui/Logo';
import Avatar from '../ui/Avatar';
import RenderSlot from '../ui/RenderSlot';
import { Badge } from '../ui/Toast';
import { StatTile } from '../ui/Pill';
import type { Feel } from '../tokens';
import s from './MainMenu.module.css';
import { useNavigate } from 'react-router';
import { useAccount } from '../lib/hooks/useAccount';
import { useFriends } from '../lib/hooks/useFriends';
import { useGameSettings } from '../lib/hooks/useGameSettings';
import { formatBeansOnline } from '../lib/api/settings';
import { lobbyPath, resolveLobbyRef } from '../lib/api/lobbyBroker.js';
import type { LobbyInviteView } from '@dont-fall/shared';
import SettingsIcon from '../ui/SettingsIcon';
import FriendAlerts from './FriendAlerts';

export type MenuDestination =
  | 'settings' | 'survival' | 'build' | 'discover' | 'leaderboards' | 'friends';

export interface MainMenuProps {
  level?: number;
  online?: string;
  feel?: Feel;
}

const NAV: Array<[string, MenuDestination]> = [
  ['FRIENDS', 'friends'],
  ['DISCOVER', 'discover'],
  ['LEADERBOARDS', 'leaderboards'],
];

export default function MainMenu({
  level = 42, online, feel,
}: MainMenuProps) {
  const navigate = useNavigate();
  const { account } = useAccount();
  // Live beans-online off /game-settings; the explicit prop (tests, previews)
  // wins, and before the fetch lands there is simply no count to show.
  const settings = useGameSettings();
  const beansOnline = online ?? (settings ? formatBeansOnline(settings.onlinePlayers) : undefined);
  // The FRIENDS badge and the alert toasts read the same cached overview the
  // Friends screen reads — the menu never fetches the roster twice.
  const friends = useFriends();
  const [notice, setNotice] = useState<string | null>(null);

  const joinInvite = (invite: LobbyInviteView) => {
    friends.dismissInvite(invite.id);
    resolveLobbyRef(invite.lobby).then(
      (lobby) => navigate(lobbyPath(lobby)),
      (err: unknown) => setNotice(err instanceof Error ? err.message : 'Could not join that Lobby.'),
    );
  };
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
              <span className={s.name}>{account?.displayName}</span>
              <span className={s.level}>LEVEL {level}</span>
            </span>
            {friends.requests.length > 0 && <Badge pulse>{friends.requests.length}</Badge>}
          </div>
          <button type="button" className={s.iconBtn} aria-label="Settings" onClick={() => navigate('/settings')}>
            <SettingsIcon style={{ width: "100%" }} />
          </button>
        </div>
      </header>

      <div className={s.body}>
        <div className={s.actions}>
          <JellyButton kicker={beansOnline ? `QUICK MATCH · ${beansOnline} BEANS ONLINE` : 'QUICK MATCH'} onClick={() => navigate("/play")}>PLAY</JellyButton>

          <div className={s.modes}>
            <JellyButton
              variant="tile" tone="danger" sub="LAST BEAN STANDING"
              onClick={() => console.log('survival')}
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" /></svg>}
            >SURVIVAL</JellyButton>

            <JellyButton
              variant="tile" tone="go" sub="4 DRAFT TRACKS"
              onClick={() => console.log('build')}
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><rect x="3" y="3" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="2" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="2" /><path d="M17.25 14v6M14.25 17h6" /></svg>}
            >BUILD</JellyButton>
          </div>

          <nav className={s.nav}>
            {NAV.map(([label, dest]) => {
              // Leaderboards has no screen yet — it logs until its own exists
              // rather than navigating nowhere.
              const target = dest === 'discover' ? '/discover' : dest === 'friends' ? '/friends' : null;
              const button = (
                <JellyButton
                  key={dest}
                  variant="pill"
                  tone="glass"
                  centered
                  onClick={() => (target === null ? console.log(dest) : navigate(target))}
                >
                  {label}
                </JellyButton>
              );
              return dest === 'friends' && friends.requests.length > 0 ? (
                <span key={dest} className={s.navItem}>
                  {button}
                  <span className={s.navBadge}>
                    <Badge pulse>{friends.requests.length}</Badge>
                  </span>
                </span>
              ) : (
                button
              );
            })}
          </nav>
          {notice !== null && <p className={s.notice}>{notice}</p>}
        </div>

        <RenderSlot grounded wobble sub="IDLE + WIN POSE LOOP" className={s.hero} />
      </div>

      <div className={s.stats}>
        <StatTile label="BEST SURVIVAL" value="06:11" />
        <StatTile label="WINS" value="137" />
        <StatTile label="GRABS BROKEN" value="892" accent />
      </div>
      <FriendAlerts
        requests={friends.requests}
        invites={friends.invites}
        onAccept={(id) => friends.acceptRequest(id).then(
          () => undefined,
          (err: unknown) => setNotice(err instanceof Error ? err.message : 'Could not accept that request.'),
        )}
        onDecline={(id) => friends.declineRequest(id).then(
          () => undefined,
          (err: unknown) => setNotice(err instanceof Error ? err.message : 'Could not decline that request.'),
        )}
        onJoinInvite={joinInvite}
        onDismissInvite={friends.dismissInvite}
      />
    </Stage>
  );
}
