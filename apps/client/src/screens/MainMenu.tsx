import { useEffect, useState } from 'react';
import { DEFAULT_EMOTE, levelForXp, PARTY_MAX_SIZE } from '@dont-fall/shared';
import Stage from '../ui/Stage';
import JellyButton from '../ui/JellyButton';
import Logo from '../ui/Logo';
import Avatar from '../ui/Avatar';
import PartyStrip from '../ui/PartyStrip';
import { CharacterPreview, EMOTE_SEQUENCES, type PreviewBean } from './CharacterPreview.js';
import InviteFriends from './InviteFriends.js';
import { Badge } from '../ui/Badge';
import { StatTile } from '../ui/Pill';
import type { Feel } from '../tokens';
import s from './MainMenu.module.css';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../lib/api/base.js';
import { fetchCareer } from '../lib/api/career.js';
import { cancelPartyInvite, leaveParty, removeFromParty } from '../lib/api/party.js';
import { copyText } from '../lib/clipboard.js';
import { flash } from '../lib/flash.js';
import { formatStay } from '../lib/utils/roundTimer.js';
import { useAccount } from '../lib/hooks/useAccount';
import { useNow } from '../lib/hooks/useNow.js';
import { useParty } from '../lib/social/accountSocket.js';
import { canLeaveParty, heroCaption, isPartyActive, partySlots, playKicker, stripHeading } from '../lib/social/partyView.js';
import { useFriends } from '../lib/hooks/useFriends';
import { useGameSettings } from '../lib/hooks/useGameSettings';
import { formatBeansOnline } from '../lib/api/settings';
import { avatarLook } from '../lib/avatar.js';
import SettingsIcon from '../ui/SettingsIcon';
import { builderUrl } from '../lib/publicUrl.js';

export type MenuDestination =
  | 'settings' | 'survival' | 'build' | 'discover' | 'leaderboards' | 'friends' | 'character' | 'credits';

export interface MainMenuProps {
  level?: number;
  online?: string;
  feel?: Feel;
}

/** How often a pending invite's INVITED · m:ss counts on the strip. */
const INVITE_CLOCK_MS = 1_000;

const NAV: Array<[string, MenuDestination]> = [
  ['CHARACTER', 'character'],
  ['FRIENDS', 'friends'],
  ['DISCOVER', 'discover'],
  ['LEADERBOARDS', 'leaderboards'],
  ['CREDITS', 'credits'],
];

export default function MainMenu({
  level, online, feel,
}: MainMenuProps) {
  const navigate = useNavigate();
  const { account } = useAccount();
  // The explicit prop (tests, previews) wins; otherwise the Account's own
  // level off the shared curve — never a mock number.
  const shownLevel = level ?? levelForXp(account?.xp ?? 0);
  // Live beans-online off /game-settings; the explicit prop (tests, previews)
  // wins, and before the fetch lands there is simply no count to show.
  const settings = useGameSettings();
  const beansOnline = online ?? (settings ? formatBeansOnline(settings.onlinePlayers) : undefined);
  // The FRIENDS badge reads the same cached overview the Friends screen
  // reads — the menu never fetches the roster twice. Answering requests and
  // invites is the global alert stack's job, not this Screen's.
  const friends = useFriends();
  // The three tiles are the career's own numbers (ADR 0110), shared with the
  // Profile screen's cache; a dash until they arrive.
  const career = useQuery({ queryKey: ['career'], queryFn: fetchCareer, enabled: account !== null }).data?.stats;
  // The menu wears your Party (ADR 0112): the strip along the bottom, where
  // the Party mock put it, and every member's bean in the hero. It is the
  // Account socket's — this Screen only draws it and sends the host's acts.
  // Only while the Party is *active* (a second bean, or an invite out): alone,
  // the bottom row is the stat tiles it has always been — the user's call
  // after the first build took them away for good.
  const party = useParty();
  const active = isPartyActive(party);
  const now = useNow(INVITE_CLOCK_MS, party.pending.length > 0);
  const [inviting, setInviting] = useState(false);
  // Only the host invites: joining someone else's Party closes the card with the power, for good.
  useEffect(() => {
    if (!party.isHost) setInviting(false);
  }, [party.isHost]);
  const heading = stripHeading(party);
  const companions: PreviewBean[] = party.others.map((member) => ({
    id: member.accountId,
    color: member.color,
    skin: member.skin,
    hat: member.hat,
  }));

  const failed = (fallback: string) => (err: unknown): void => {
    flash(err instanceof Error ? err.message : fallback, 'error');
  };
  /**
   * The host's × — at once, no confirm (the mock's rule): a pending slot is
   * un-invited, a seated bean removed. One already gone (answered, expired,
   * left) is what the × wanted anyway, so a 404 says nothing.
   */
  const kick = (accountId: string): void => {
    const invite = party.pending.find((pending) => pending.accountId === accountId);
    const request = invite ? cancelPartyInvite(invite.inviteId) : removeFromParty(accountId);
    request.catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 404) return;
      failed(invite ? 'Could not cancel that invite.' : 'Could not remove that bean.')(err);
    });
  };
  const leave = (): void => {
    const hostName = party.isHost ? null : (party.host?.displayName ?? null);
    leaveParty().then(
      () => flash(hostName === null ? 'You left the party.' : `You left ${hostName}'s party.`),
      failed('Could not leave the party.'),
    );
  };
  const partyCode = party.party?.code ?? undefined;

  return (
    <Stage
      background="var(--df-stage-menu)"
      sheen="var(--df-sheen-menu)"
      feel={feel}
      className={s.screen}
      overlay={
        inviting && party.isHost ? (
          <div className={s.scrim} onClick={() => setInviting(false)}>
            <div className={s.invite} onClick={(e) => e.stopPropagation()}>
              <InviteFriends onClose={() => setInviting(false)} />
            </div>
          </div>
        ) : undefined
      }
    >
      <header className={s.header}>
        <div className={s.identity}>
          <Logo size={2.65} chrome />
        </div>

        <div className={s.identity}>
          <button type="button" className={s.account} onClick={() => navigate("/profile")} aria-label="Profile">
            <Avatar look={account ? avatarLook(account.id, account.color, account.avatarUploadedAt) : undefined} />
            <span className={s.accountText}>
              <span className={s.name}>{account?.displayName}</span>
              <span className={s.level}>LEVEL {shownLevel}</span>
            </span>
            {friends.requests.length > 0 && <Badge pulse>{friends.requests.length}</Badge>}
          </button>
          <button type="button" className={s.iconBtn} aria-label="Settings" onClick={() => navigate('/settings')}>
            <SettingsIcon style={{ width: "100%" }} />
          </button>
        </div>
      </header>

      {/* The Party mock widens the action column for the strip below it; alone, the body splits as it always did. */}
      <div className={[s.body, active ? undefined : s.bodyAlone].filter(Boolean).join(' ')}>
        <div className={s.actions}>
          <JellyButton kicker={playKicker(party, beansOnline)} onClick={() => navigate("/play")}>PLAY</JellyButton>

          <div className={s.modes}>
            <JellyButton
              variant="tile" tone="danger" sub="LAST BEAN STANDING"
              onClick={() => console.log('survival')}
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" /></svg>}
            >SURVIVAL</JellyButton>

            <JellyButton
              variant="tile" tone="go" sub="4 DRAFT TRACKS"
              onClick={() => window.open(builderUrl())}
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><rect x="3" y="3" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="2" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="2" /><path d="M17.25 14v6M14.25 17h6" /></svg>}
            >BUILD</JellyButton>
          </div>

          <nav className={s.nav}>
            {NAV.map(([label, dest]) => {
              const target =
                dest === 'character'
                  ? '/character'
                  : dest === 'discover'
                    ? '/discover'
                    : dest === 'friends'
                      ? '/friends'
                      : dest === 'credits'
                        ? '/credits'
                        : dest === 'leaderboards'
                          ? '/leaderboards'
                          : null;
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
        </div>

        <CharacterPreview
          color={account?.color ?? null}
          skin={account?.skin ?? null}
          hat={account?.hat ?? null}
          // Idles, then plays the emote the Account picked in Character Select (ADR 0110).
          animation={[{ clip: "Idle", seconds: 4 }, ...EMOTE_SEQUENCES[account?.emote ?? DEFAULT_EMOTE]]}
          // The rest of your Party idles beside you, each in their own look (ADR 0112).
          party={companions}
          sub={heroCaption(party)}
          canvasLabel={companions.length > 0 ? "3D preview of your party" : "3D preview of your bean"}
          className={s.hero}
          autoRotate={false}
        />
      </div>

      {active ? (
        <PartyStrip
          members={partySlots(party, account, now)}
          capacity={PARTY_MAX_SIZE}
          isHost={party.isHost}
          title={heading.title}
          note={heading.note}
          code={partyCode}
          onCopyCode={partyCode === undefined ? undefined : () => void copyText(partyCode, 'Party code copied.', "Couldn't copy the code.")}
          onlineCount={friends.online}
          onInvite={() => setInviting(true)}
          onKick={kick}
          onLeave={leave}
          leaveDisabled={!canLeaveParty(party)}
        />
      ) : (
        <div className={s.stats}>
          <StatTile label="BEST SURVIVAL" value={career?.bestSurvivalMs == null ? '—' : formatStay(career.bestSurvivalMs)} />
          <StatTile label="WINS" value={career ? String(career.wins) : '—'} />
          <StatTile label="GRABS BROKEN" value={career ? String(career.grabsBroken) : '—'} accent />
        </div>
      )}
    </Stage>
  );
}
