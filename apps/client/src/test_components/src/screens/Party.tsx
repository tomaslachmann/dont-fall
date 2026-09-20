import { useState } from 'react';
import Stage from '../ui/Stage';
import Logo from '../ui/Logo';
import Avatar from '../ui/Avatar';
import JellyButton from '../ui/JellyButton';
import RenderSlot from '../ui/RenderSlot';
import SettingsIcon from '../ui/SettingsIcon';
import Toast from '../ui/Toast';
import PartyStrip from '../ui/PartyStrip';
import type { PartyMember } from '../ui/PartyStrip';
import type { Skin } from '../ui/Avatar';
import { InviteCard } from './InviteFriends';
import type { InviteCandidate } from './InviteFriends';
import type { Feel } from '../tokens';
import s from './Party.module.css';

export interface PartyProps {
  playerName?: string;
  level?: number;
  /** Starting roster. Slot 1 is normally the host. */
  members?: PartyMember[];
  capacity?: number;
  isHost?: boolean;
  /** Host's name — titles the strip when you're not the host. */
  hostName?: string;
  code?: string;
  /** Renders the "you were removed" toast (4f). */
  kickedBy?: string;
  candidates?: InviteCandidate[];
  onPlay?: () => void;
  onLeave?: () => void;
  feel?: Feel;
}

const PARTY: PartyMember[] = [
  { name: 'NOODLEBEAN', skin: 'pink', you: true, host: true },
  { name: 'FLOPPO', skin: 'cyan', level: 31 },
  { name: 'GOOPY', skin: 'mint', level: 12 },
];

const SKINS: Skin[] = ['pink', 'cyan', 'mint', 'gold', 'grape'];

export default function Party({
  playerName = 'NOODLEBEAN', level = 42, members = PARTY, capacity = 4, isHost = true,
  hostName, code = '4K7NQX', kickedBy, candidates, onPlay, onLeave, feel,
}: PartyProps) {
  const [roster, setRoster] = useState<PartyMember[]>(members);
  const [inviting, setInviting] = useState(false);

  const free = Math.max(0, capacity - roster.length);
  const ready = roster.filter((m) => !m.pending).length;

  /** Immediate, by design — one tap on the × and the bean is gone. */
  const kick = (name: string) => setRoster((r) => r.filter((m) => m.name !== name));

  const invite = (name: string) => {
    const c = candidates?.find((x) => x.name === name);
    setRoster((r) => (r.length >= capacity ? r : [...r, {
      name,
      skin: c?.skin ?? SKINS[r.length % SKINS.length],
      pending: true,
      waiting: '0:03',
    }]));
  };

  const inviteList: InviteCandidate[] = (candidates ?? DEFAULT_CANDIDATES).map((c) => {
    const seated = roster.find((m) => m.name === c.name);
    if (!seated) return c;
    return seated.pending
      ? { ...c, state: 'invited', status: `INVITED · WAITING ${seated.waiting ?? '0:03'}` }
      : { ...c, state: 'busy', status: 'ALREADY IN YOUR PARTY' };
  });

  return (
    <Stage
      background="var(--df-stage-menu)"
      sheen="var(--df-sheen-menu)"
      feel={feel}
      className={s.screen}
      overlay={(
        <>
          {kickedBy && (
            <Toast
              className={s.toast}
              skin="cyan"
              title={`${kickedBy} REMOVED YOU FROM THE PARTY`}
              body="You're on your own again — invite someone or jump into a quick match."
            />
          )}
          {inviting && (
            <div className={s.scrim} onClick={() => setInviting(false)}>
              <div onClick={(e) => e.stopPropagation()}>
                <InviteCard
                  slotsLeft={free}
                  code={code}
                  candidates={inviteList}
                  onInvite={invite}
                  onCancel={kick}
                  onClose={() => setInviting(false)}
                  feel={feel}
                />
              </div>
            </div>
          )}
        </>
      )}
    >
      <header className={s.header}>
        <div className={s.identity}><Logo size={2.65} chrome /></div>
        <div className={s.identity}>
          <div className={s.account}>
            <Avatar skin="pink" />
            <span className={s.accountText}>
              <span className={s.name}>{playerName}</span>
              <span className={s.level}>LEVEL {level}</span>
            </span>
          </div>
          <button type="button" className={s.iconBtn} aria-label="Settings"><SettingsIcon inverse /></button>
        </div>
      </header>

      <div className={s.body}>
        <div className={s.actions}>
          <JellyButton
            feel={feel}
            kicker={ready > 1 ? `PLAY AS A PARTY · ${ready} BEANS READY` : 'QUICK MATCH · 3 244 BEANS ONLINE'}
            onClick={onPlay}
          >PLAY</JellyButton>

          <div className={s.modes}>
            <JellyButton variant="tile" tone="danger" sub="LAST BEAN STANDING">SURVIVAL</JellyButton>
            <JellyButton variant="tile" tone="go" sub="4 DRAFT TRACKS">BUILD</JellyButton>
          </div>
        </div>

        <RenderSlot grounded wobble sub="PARTY OF FOUR, IDLE LOOP" className={s.hero} />
      </div>

      <PartyStrip
        members={roster}
        capacity={capacity}
        isHost={isHost}
        title={isHost ? 'YOUR PARTY' : `${hostName ?? 'FLOPPO'}'S PARTY`}
        note={
          isHost
            ? (roster.length === 1 ? 'Invite up to three friends — the party stays together between rounds.' : undefined)
            : 'Only the host can invite or remove beans.'
        }
        code={code}
        onlineCount={7}
        onInvite={() => setInviting(true)}
        onKick={kick}
        onLeave={onLeave}
        feel={feel}
      />
    </Stage>
  );
}

const DEFAULT_CANDIDATES: InviteCandidate[] = [
  { name: 'BONK', skin: 'pink', status: 'ONLINE · IN MENU' },
  { name: 'SPLAT', skin: 'mint', status: 'IN A RACE · CAN STILL JOIN', inRace: true },
  { name: 'WIGGLY', skin: 'grape', status: 'ONLINE · IN MENU' },
  { name: 'TUMBLES', skin: 'gold', status: 'IN ANOTHER PARTY · 4/4', state: 'busy' },
  { name: 'MRBEANO', skin: 'cyan', status: 'OFFLINE · 2 DAYS AGO', state: 'busy', offline: true },
];
