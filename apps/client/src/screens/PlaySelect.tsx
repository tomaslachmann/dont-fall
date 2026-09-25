import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Stage from '../ui/Stage';
import Panel, { PanelHead } from '../ui/Panel';
import JellyButton from '../ui/JellyButton';
import Pill from '../ui/Pill';
import Toggle from '../ui/Toggle';
import Stepper from '../ui/Stepper';
import Avatar from '../ui/Avatar';
import type { Feel } from '../tokens';
import { BOT_LEVELS, DEFAULT_BOT_LEVEL, DEFAULT_MATCH_LENGTH, MAX_MATCH_LENGTH, MAX_PLAYERS, MIN_MATCH_LENGTH } from '@dont-fall/shared';
import { createLobby, lobbyByCode, lobbyPath, quickMatch, resolveLobbyRef, type BrokeredLobby } from '../lib/api/lobbyBroker.js';
import { avatarLook } from '../lib/avatar.js';
import { useAccount } from '../lib/hooks/useAccount';
import { useFriends } from '../lib/hooks/useFriends';
import { useParty } from '../lib/social/accountSocket.js';
import { queueBlockedReason } from '../lib/social/partyGate.js';
import { useGameSettings } from '../lib/hooks/useGameSettings';
import { formatBeansOnline } from '../lib/api/settings';
import s from './PlaySelect.module.css';
import { useNavigate } from 'react-router';

export type PlayMode = 'quick' | 'create' | 'join';

export interface PlaySelectProps {
  online?: string;
  /** Friends currently in a joinable lobby — shown under JOIN. */
  onConfirm?: (mode: PlayMode, payload?: { code?: string; privacy?: string; rounds?: number }) => void;
  defaultMode?: PlayMode;
  feel?: Feel;
}

const ICONS: Record<PlayMode, ReactNode> = {
  quick: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2L4.5 13.5H11l-1.4 8.5L19 10h-6.4z" />
    </svg>
  ),
  create: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
      <rect x="3.2" y="5" width="17.6" height="14" rx="3.4" />
      <path d="M12 9v6M9 12h6" />
    </svg>
  ),
  join: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
      <path d="M14 4h4.4A2.6 2.6 0 0121 6.6v10.8A2.6 2.6 0 0118.4 20H14" />
      <path d="M3 12h9.5M9.4 8.2L13.2 12l-3.8 3.8" />
    </svg>
  ),
};

const MODES: Array<{ key: PlayMode; label: string; sub: string }> = [
  { key: 'quick', label: 'QUICK MATCH', sub: 'Straight into the next race' },
  { key: 'create', label: 'CREATE PRIVATE LOBBY', sub: 'Your rules, your beans' },
  { key: 'join', label: 'JOIN PRIVATE LOBBY', sub: 'Got a 6-letter code?' },
];

const CODE_LEN = 6;

export default function PlaySelect({
  online, onConfirm, defaultMode = 'quick', feel,
}: PlaySelectProps) {
  // Live values off /game-settings; the explicit prop (tests, previews) wins,
  // and the lobby size falls back to the shared cap — the same default the
  // server boots with — until the fetch lands.
  const settings = useGameSettings();
  const beansOnline = online ?? (settings ? formatBeansOnline(settings.onlinePlayers) : undefined);
  const lobbySize = settings?.maxPlayers ?? MAX_PLAYERS;
  // Friends waiting in a Lobby you could join right now (ADR 0110), off the
  // same presence the Friends screen reads.
  const friendsInALobby = useFriends().friends.filter(
    (friend) => friend.presence.status === 'in-lobby' && friend.presence.joinable && friend.presence.lobby,
  );
  // Your Party (ADR 0112): who a Quick Match brings, and whose call it is.
  // Only the Party host queues — the Party follows it everywhere — and the
  // host's queue waits for every member to be back in the menus. CREATE and
  // JOIN stay open to a member: entering alone just leaves the Party.
  const { account } = useAccount();
  const party = useParty();
  const quickBlocked = queueBlockedReason(party);
  const friendsBrought = party.others.length;
  const navigate = useNavigate();
  const [mode, setMode] = useState<PlayMode>(defaultMode);
  const [privacy, setPrivacy] = useState('INVITE ONLY');
  const [rounds, setRounds] = useState(DEFAULT_MATCH_LENGTH);
  // M17 ticket 10: how many Bots fill the open places when the Round starts,
  // and their level. None by default; the host can change both in the Lobby.
  const [botCount, setBotCount] = useState(0);
  const [botLevel, setBotLevel] = useState(DEFAULT_BOT_LEVEL.toUpperCase());
  const [code, setCode] = useState<string[]>(() => Array(CODE_LEN).fill(''));
  // One in-flight broker call at a time, and the reason the last one failed
  // — the broker's own words (an unknown code, a Lobby that filled up),
  // never a second opinion invented here.
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cells = useRef<Array<HTMLInputElement | null>>([]);

  const joined = code.join('');
  const codeReady = joined.length === CODE_LEN && !code.includes('');

  /**
   * Every way in goes through the lobby broker (ADR 0054), never straight to
   * a Match server: the broker decides which Lobby exists and on what port,
   * and `/lobby` connects to exactly the port it names. The port travels in
   * the URL rather than in router state so a Lobby stays reloadable for as
   * long as it lives — the same reasoning `/play?track=` already follows.
   */
  const enterLobby = (chosen: PlayMode, ask: () => Promise<BrokeredLobby>): void => {
    if (pending) return;
    setPending(true);
    setError(null);
    void ask()
      .then((lobby) => {
        onConfirm?.(chosen, {
          ...(lobby.code === undefined ? {} : { code: lobby.code }),
          privacy,
          rounds,
        });
        // Only a Lobby that actually has a join code carries one — a
        // quick-matched public Lobby has none to show.
        navigate(lobbyPath(lobby));
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setPending(false);
      });
  };

  const typeCell = (i: number, raw: string) => {
    const chars = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').split('');
    if (!chars.length) {
      setCode((v) => v.map((c, n) => (n === i ? '' : c)));
      return;
    }
    setCode((v) => {
      const next = [...v];
      chars.forEach((ch, n) => { if (i + n < CODE_LEN) next[i + n] = ch; });
      return next;
    });
    cells.current[Math.min(CODE_LEN - 1, i + chars.length)]?.focus();
  };

  const cellKey = (i: number, key: string) => {
    if (key === 'Backspace' && !code[i] && i > 0) cells.current[i - 1]?.focus();
    if (key === 'ArrowLeft' && i > 0) cells.current[i - 1]?.focus();
    if (key === 'ArrowRight' && i < CODE_LEN - 1) cells.current[i + 1]?.focus();
  };

  return (
    <Stage
      background="var(--df-stage-menu)"
      sheen="var(--df-color-scrim)"
      feel={feel}
      className={s.screen}
    >
      <Panel modal className={s.card}>
        <PanelHead title="PLAY">
          <div className={s.headMeta}>
            <Pill>{beansOnline ? `${beansOnline} BEANS ONLINE` : 'BEANS ONLINE'}</Pill>
            <button type="button" className={s.close} data-ui-sound="back" onClick={() => navigate("/")} aria-label="Back to menu">×</button>
          </div>
        </PanelHead>

        <div className={s.body}>
          <div className={s.modes} role="tablist" aria-label="Play mode">
            {MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                role="tab"
                aria-selected={mode === m.key}
                onClick={() => { setMode(m.key); setError(null); }}
                className={[s.mode, mode === m.key && s.modeOn].filter(Boolean).join(' ')}
              >
                <span className={s.modeIcon}>{ICONS[m.key]}</span>
                <span className={s.modeText}>
                  <span className={s.modeLabel}>{m.label}</span>
                  <span className={s.modeSub}>{m.sub}</span>
                </span>
              </button>
            ))}
          </div>

          <div className={s.detail}>
            {mode === 'quick' && (
              <>
                <div className={s.detailHead}>
                  <span className={s.kicker}>FASTEST WAY IN</span>
                  <h2 className={s.title}>Drop into the next race with {lobbySize - party.size} strangers.</h2>
                </div>
                <div className={s.rows}>
                  <div className={s.row}>
                    <span className={s.rowLabel}>REGION</span>
                    <Pill tone="plate">EU WEST · 24 ms</Pill>
                  </div>
                  <div className={s.row}>
                    <span className={s.rowLabel}>QUEUE</span>
                    <Pill tone="plate">~18 s WAIT</Pill>
                  </div>
                </div>
                <div className={s.party}>
                  <span className={s.rowLabel}>BRINGING</span>
                  <span className={s.faces}>
                    {/* You first, then your Party's other beans in joining order. */}
                    <Avatar look={account ? avatarLook(account.id, account.color, account.avatarUploadedAt) : undefined} />
                    {party.others.map((member) => (
                      <Avatar key={member.accountId} look={avatarLook(member.accountId, member.color, member.avatarUploadedAt)} />
                    ))}
                  </span>
                  <span className={s.partyNote}>
                    {friendsBrought === 0
                      ? 'Just you — invite friends from the menu'
                      : `${friendsBrought} ${friendsBrought === 1 ? 'friend' : 'friends'} in your party`}
                  </span>
                </div>
                {/* POST /lobbies/quick-match — an open public Lobby with room for the whole Party, or a fresh one. */}
                <JellyButton
                  disabled={pending || quickBlocked !== null}
                  kicker={quickBlocked ?? (pending ? 'FINDING A LOBBY…' : 'MATCHMAKING')}
                  onClick={() => enterLobby('quick', () => quickMatch())}
                >
                  FIND A MATCH
                </JellyButton>
              </>
            )}

            {mode === 'create' && (
              <>
                <div className={s.detailHead}>
                  <span className={s.kicker}>PRIVATE LOBBY</span>
                  <h2 className={s.title}>Set it up, then share the code.</h2>
                </div>
                <div className={s.rows}>
                  <div className={s.row}>
                    <span className={s.rowLabel}>WHO CAN JOIN</span>
                    <Toggle options={['FRIENDS', 'INVITE ONLY']} value={privacy} onChange={setPrivacy} />
                  </div>
                  <div className={s.row}>
                    <span className={s.rowLabel}>ROUNDS</span>
                    <Stepper value={rounds} min={MIN_MATCH_LENGTH} max={MAX_MATCH_LENGTH} onChange={setRounds} />
                  </div>
                  <div className={s.row}>
                    <span className={s.rowLabel}>BOTS</span>
                    <Stepper value={botCount} label="Bots" min={0} max={Math.max(0, lobbySize - 1)} onChange={setBotCount} />
                  </div>
                  {botCount > 0 && (
                    <div className={s.row}>
                      <span className={s.rowLabel}>BOT LEVEL</span>
                      <Toggle options={BOT_LEVELS.map((level) => level.toUpperCase())} value={botLevel} onChange={setBotLevel} />
                    </div>
                  )}
                  <div className={s.row}>
                    <span className={s.rowLabel}>LOBBY SIZE</span>
                    <Pill tone="plate">UP TO {lobbySize} BEANS</Pill>
                  </div>
                </div>
                {/* POST /lobbies {isPrivate, matchLength, privacy, bots?} — the broker answers with the join code to share. */}
                <JellyButton
                  disabled={pending}
                  kicker={pending ? 'STARTING A LOBBY…' : 'YOU HOST'}
                  // ADR 0110: ROUNDS and WHO CAN JOIN travel with the create.
                  onClick={() =>
                    enterLobby('create', () =>
                      createLobby(true, {
                        matchLength: rounds,
                        privacy: privacy === 'FRIENDS' ? 'friends' : 'invite-only',
                        // Sent only when there are Bots: a Lobby starts with none (M17 ticket 10).
                        ...(botCount > 0
                          ? { bots: { enabled: true, max: botCount, level: BOT_LEVELS.find((level) => level.toUpperCase() === botLevel) ?? DEFAULT_BOT_LEVEL } }
                          : {}),
                      }),
                    )
                  }
                >CREATE LOBBY</JellyButton>
              </>
            )}

            {mode === 'join' && (
              <>
                <div className={s.detailHead}>
                  <span className={s.kicker}>ENTER CODE</span>
                  <h2 className={s.title}>Six letters from whoever’s hosting.</h2>
                </div>

                <div className={s.code}>
                  {code.map((c, i) => (
                    <input
                      key={i}
                      ref={(el) => { cells.current[i] = el; }}
                      className={[s.cell, c && s.cellFull].filter(Boolean).join(' ')}
                      value={c}
                      inputMode="text"
                      autoComplete="off"
                      spellCheck={false}
                      aria-label={`Code character ${i + 1}`}
                      onChange={(e) => typeCell(i, e.target.value)}
                      onKeyDown={(e) => cellKey(i, e.key)}
                    />
                  ))}
                </div>

                {friendsInALobby.length > 0 && (
                <div className={s.recent}>
                  <span className={s.rowLabel}>FRIENDS IN A LOBBY</span>
                  {friendsInALobby.map((friend) => {
                    const lobby = friend.presence.lobby!;
                    const open = friend.presence.slotsOpen ?? 0;
                    return (
                      <button
                        key={friend.accountId}
                        type="button"
                        className={s.recentRow}
                        onClick={() =>
                          lobby.kind === 'private'
                            ? typeCell(0, lobby.code)
                            : enterLobby('join', () => resolveLobbyRef(lobby))
                        }
                      >
                        <Avatar look={avatarLook(friend.accountId, friend.color)} />
                        <span className={s.recentText}>
                          <span className={s.recentName}>{friend.displayName.toUpperCase()}</span>
                          <span className={s.recentSub}>
                            {lobby.kind === 'private' ? lobby.code : 'PUBLIC'} · {open} {open === 1 ? 'SLOT' : 'SLOTS'} OPEN · waiting
                          </span>
                        </span>
                        <span className={s.recentJoin}>{lobby.kind === 'private' ? 'USE CODE' : 'JOIN'}</span>
                      </button>
                    );
                  })}
                </div>
                )}

                {/* POST /lobbies/join {code} — 404/409 come back as the broker's own reason, shown below. */}
                <JellyButton
                  disabled={!codeReady || pending}
                  kicker={pending ? 'LOOKING FOR THAT LOBBY…' : codeReady ? 'READY' : 'NEEDS 6 CHARACTERS'}
                  onClick={() => enterLobby('join', () => lobbyByCode(joined))}
                >JOIN LOBBY</JellyButton>
              </>
            )}

            {error !== null && <p className={s.error} role="alert">{error}</p>}
          </div>
        </div>
      </Panel>
    </Stage>
  );
}
