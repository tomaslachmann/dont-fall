import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  MAX_MATCH_LENGTH,
  MIN_MATCH_LENGTH,
  NICKNAME_MAX_LENGTH,
  ROUND_TYPES,
  allReady,
  roundTypeLabel,
  type RoundType,
} from '@dont-fall/shared';
import { copyText } from '../lib/clipboard.js';
import Stage from '../ui/Stage';
import Panel from '../ui/Panel';
import JellyButton from '../ui/JellyButton';
import Avatar from '../ui/Avatar';
import { skinForPlayerId as skinFor } from '../lib/avatarSkins.js';
import Chip from '../ui/Chip';
import Stepper from '../ui/Stepper';
import ReadySwitch from '../ui/ReadySwitch';
import type { Feel } from '../tokens';
import type { LobbySnapshot } from '../lib/socket/lobbyConnection.js';
import { formatRoundClock } from '../lib/utils/roundTimer.js';
import { useAccount } from '../lib/hooks/useAccount.js';
import { useDiscoverTracks } from '../lib/hooks/useDiscoverTracks.js';
import Discover from './Discover.js';
import s from './Lobby.module.css';

export interface LobbyProps {
  /** The Lobby as the server currently reports it (ADR 0040) — rendered, never computed. */
  lobby: LobbySnapshot;
  /**
   * The broker's 6-character join code for this Lobby, when there is one
   * (ADR 0054) — private Lobbies only. A quick-matched public Lobby has none.
   */
  code?: string;
  onSetNickname: (nickname: string) => void;
  onSetReady: (ready: boolean) => void;
  onSelectTrack: (trackId: string) => void;
  onSetRoundType: (roundType: RoundType) => void;
  /** Host-only: sets this Match's length (M7 ticket 05, ADR 0049). */
  onSetMatchLength: (matchLength: number) => void;
  /** Host-only: picks (or clears, passing `null`/`null`) a future Round's slot (M7 ticket 05). */
  onPickRoundSlot: (roundIndex: number, trackId: string | null, roundType: RoundType | null) => void;
  onStart: () => void;
  /** Leaving the Lobby entirely. Defaults to navigating back to the Play Screen. */
  onLeave?: () => void;
  feel?: Feel;
}

/** Thumbnails carry the one thing actually known about a Round before it starts: its type. */
const THUMBS: Record<'race' | 'survival' | 'random', [string, string]> = {
  race: ['#BFE9FF', '#9CDCFF'],
  survival: ['#FFC9E4', '#FFB4DC'],
  random: ['#E7DDFA', '#DCCFF7'],
};

const MODE_TONE = { race: 'race', survival: 'survival' } as const;

const stripe = ([a, b]: [string, string]) =>
  `repeating-linear-gradient(115deg,${a} 0 calc(var(--df-u) * .7),${b} calc(var(--df-u) * .7) calc(var(--df-u) * 1.4))`;

const SwapIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h6l8 10h4" /><path d="M18 3l3 4-3 4" /><path d="M3 17h6" /></svg>
);

/**
 * The Lobby (M4 ticket 07, ADR 0040), rendered by the `/lobby` route on its
 * own shell-owned connection (ADR 0056) — no game boots for a roster, a
 * Ready switch and a Track pick. The connection underneath is what keeps the
 * roster, Ready state and Track pick in sync, and it is the same socket the
 * game later attaches to once the Match starts.
 *
 * Every field here is server-replicated: the roster and its host, the Round
 * type and Time Limit, the Match length and its future Round slots, the
 * server's own reason a Round can't start, and the capacity the server was
 * configured with. The one exception is `code`, which comes from the lobby
 * broker (ADR 0054) — the Match server has no idea it was brokered.
 */
export default function Lobby({
  lobby,
  code,
  onSetNickname,
  onSetReady,
  onSelectTrack,
  onSetRoundType,
  onSetMatchLength,
  onPickRoundSlot,
  onStart,
  onLeave,
  feel,
}: LobbyProps) {
  const navigate = useNavigate();
  const me = lobby.players.find((p) => p.id === lobby.myId);
  const isHost = lobby.hostId === lobby.myId;
  const { account } = useAccount();

  /**
   * This Player is named by their Account, not by anything typed here (ADR
   * 0052: login is mandatory, so a Lobby-local nickname would be a second,
   * conflicting identity). Sent once the roster actually has this Player in
   * it and the name doesn't already match — the server echoes it straight
   * back on the next snapshot, which is what stops this from re-firing.
   */
  const myNickname = me?.nickname;
  useEffect(() => {
    const name = account?.displayName;
    if (name === undefined || myNickname === undefined || myNickname === name) return;
    onSetNickname(name.slice(0, NICKNAME_MAX_LENGTH));
  }, [account?.displayName, myNickname, onSetNickname]);

  // Only the host ever picks a Track, so only the host pays for the fetch —
  // one cached query (fresh for 30s), not a fetch per mount. A failed list
  // simply offers no picker, same as before: the Track arrives over the
  // socket anyway. Shared with the inline Track browser below (M9 ticket
  // 16): browsing reads this same cache, never refetches it.
  const discover = useDiscoverTracks(isHost);
  const tracks = discover.tracks;
  const [browsing, setBrowsing] = useState(false);

  const readyCount = lobby.players.filter((p) => p.ready).length;
  const waiting = lobby.players.length - readyCount;
  const open = Math.max(0, lobby.maxPlayers - lobby.players.length);
  const trackName = (id: string | null): string =>
    id === null ? 'RANDOM PICK' : (tracks?.find((t) => t.id === id)?.name ?? id);

  /**
   * The swap button walks the fetched Track list (M4 ticket 07's picker,
   * in this design's shape) — one press, the next Track. A slot after
   * Round 1 wraps through "random" as well, since `null` there is a real
   * choice: let the server draw it.
   */
  const nextTrackAfter = (current: string | null, includeRandom: boolean): string | null => {
    const ids = tracks?.map((t) => t.id) ?? [];
    if (ids.length === 0) return current;
    const options: (string | null)[] = includeRandom ? [null, ...ids] : ids;
    const at = options.indexOf(current);
    return options[(at + 1) % options.length] ?? null;
  };

  /** Round 1 cycles between the real types; a later slot wraps through `null` — "the server draws this." */
  const nextRoundType = (current: RoundType | null, includeRandom: boolean): RoundType | null => {
    const options: (RoundType | null)[] = includeRandom ? [null, ...ROUND_TYPES] : [...ROUND_TYPES];
    const at = options.indexOf(current);
    return options[(at + 1) % options.length] ?? null;
  };

  const copyInvite = (): void => {
    if (code === undefined) return;
    copyText(code, "Invite code copied.", "Couldn't copy the code.");
  };

  /**
   * The inline Track browser (M9 ticket 16) — the same Discover catalogue
   * the standalone route shows, rendered in place so this route (and its
   * socket) never unmounts: the pick travels over the Lobby's own live
   * connection, and navigating away would drop it. A card selects straight
   * into Round 1 and closes; back closes without picking.
   */
  if (browsing) {
    return (
      <Discover
        tracks={tracks ?? []}
        isLoading={discover.isLoading}
        error={discover.error}
        onRetry={discover.retry}
        selectedId={lobby.trackId}
        onSelect={(trackId) => {
          onSelectTrack(trackId);
          setBrowsing(false);
        }}
        onBack={() => setBrowsing(false)}
        {...(feel === undefined ? {} : { feel })}
      />
    );
  }

  return (
    <Stage background="var(--df-stage-lobby)" sheen="var(--df-sheen-menu)" feel={feel} className={s.screen}>
      <div className={s.topbar}>
        <div className={s.crumb}>
          <button type="button" className={s.back} onClick={() => (onLeave ? onLeave() : navigate('/play'))} aria-label="Leave Lobby">
            <svg viewBox="0 0 18 18"><path d="M11 3L5 9l6 6" /></svg>
          </button>
          <span className={s.title}>LOBBY</span>
          <span className={s.room}>
            <span className={s.roomLabel}>ROOM</span>
            {/* The broker's own join code (ADR 0054). A quick-matched public Lobby has none to share. */}
            <span className={s.roomCode}>{code ?? 'QUICK MATCH'}</span>
          </span>
        </div>
        <div className={s.topActions}>
          <JellyButton
            variant="pill"
            tone="glass"
            centered
            disabled={code === undefined}
            onClick={copyInvite}
          >INVITE FRIENDS</JellyButton>
          <Chip tone="plate" lg>{code === undefined ? 'PUBLIC' : 'PRIVATE'}</Chip>
        </div>
      </div>

      <div className={s.room_col}>
        <div className={s.count}>
          <span className={s.countLabel}>BEANS IN THE ROOM</span>
          <span className={s.countValue} data-df-numeric>
            {String(lobby.players.length).padStart(2, '0')}<span className={s.countTotal}>/{lobby.maxPlayers}</span>
          </span>
        </div>

        <div className={s.grid}>
          {lobby.players.map((p) => (
            <div key={p.id} className={[s.player, !p.ready && s.pending].filter(Boolean).join(' ')}>
              <div className={s.playerHead}>
                <Avatar skin={skinFor(p.id)} size={4} {...(p.id === lobby.myId ? { ring: 'var(--df-color-accent)' } : {})} />
                {p.id === lobby.hostId && <Chip tone="host">HOST</Chip>}
              </div>
              <span className={s.playerName}>{p.nickname}</span>
              <Chip tone={p.ready ? 'ready' : 'waiting'} dot>{p.ready ? 'READY' : 'WAITING'}</Chip>
            </div>
          ))}
          {open > 0 && (
            <div className={s.slots}>
              <span className={s.slotsPlus}>+</span>
              <span className={s.slotsLabel}>{open} {open === 1 ? 'SLOT' : 'SLOTS'} OPEN</span>
            </div>
          )}
        </div>

        <div className={s.foot}>
          {/*
            Only this Player's own Ready is a control — everyone else's is
            the chip on their card. No auto-start countdown to hint at: the
            host starts the Round (ADR 0040).
          */}
          <ReadySwitch
            ready={me?.ready ?? false}
            onChange={onSetReady}
            tally={`${readyCount} OF ${lobby.players.length} READY`}
            {...(waiting > 0 ? { hint: `WAITING ON ${waiting} ${waiting === 1 ? 'BEAN' : 'BEANS'}` } : {})}
          />
        </div>
      </div>

      <div className={s.room_col}>
        <Panel className={s.setup} style={{ gridRow: 'span 2' }}>
          <div className={s.setupHead}>
            <span>
              <span className={s.setupTitle}>ROUNDS</span>
              <span className={s.setupSub}>HOST ONLY</span>
            </span>
            {isHost ? (
              <Stepper
                value={lobby.matchLength}
                label="Rounds"
                min={MIN_MATCH_LENGTH}
                max={MAX_MATCH_LENGTH}
                onChange={onSetMatchLength}
              />
            ) : (
              <span className={s.setupTitle}>
                {lobby.matchLength} {lobby.matchLength === 1 ? 'Round' : 'Rounds'}
              </span>
            )}
          </div>

          <div className={s.rounds}>
            {/*
              Round 1 is the Track and Round type this Lobby is actually
              loaded on — its own pick mechanism (`selectTrack`/
              `setRoundType`), which reloads both sides' simulation. Every
              later Round is a slot the server draws for unless the host
              fills it in (M7 ticket 05).
            */}
            <div className={[s.round, s.roundActive].join(' ')}>
              <span className={s.roundNo}>1</span>
              <span className={s.thumb} style={{ background: stripe(THUMBS[lobby.roundType] ?? THUMBS.random) }} />
              <span className={s.roundText}>
                <span className={s.roundName}>{trackName(lobby.trackId)}</span>
                <span>
                  {/*
                    Everyone reads the Round type off this chip, host or not
                    (M5 ticket 07) — for the host it is also the control
                    that changes it.
                  */}
                  {isHost ? (
                    <button
                      type="button"
                      className={s.modeButton}
                      aria-label="Change Round type for Round 1"
                      onClick={() => onSetRoundType(nextRoundType(lobby.roundType, false) ?? lobby.roundType)}
                    >
                      <Chip tone={MODE_TONE[lobby.roundType]}>{roundTypeLabel(lobby.roundType).toUpperCase()}</Chip>
                    </button>
                  ) : (
                    <Chip tone={MODE_TONE[lobby.roundType]}>{roundTypeLabel(lobby.roundType).toUpperCase()}</Chip>
                  )}
                </span>
              </span>
              {isHost && (
                <button
                  type="button"
                  className={s.swap}
                  aria-label="Change Track for Round 1"
                  disabled={tracks === null || tracks.length === 0}
                  onClick={() => {
                    const next = nextTrackAfter(lobby.trackId, false);
                    if (next !== null && next !== lobby.trackId) onSelectTrack(next);
                  }}
                ><SwapIcon /></button>
              )}
            </div>

            {lobby.roundPicks.map((pick, i) => {
              const roundIndex = i + 1; // 0-based; index 0 is Round 2
              const thumb = pick.roundType === null ? THUMBS.random : (THUMBS[pick.roundType] ?? THUMBS.random);
              return (
                <div key={roundIndex} className={s.round}>
                  <span className={s.roundNo}>{roundIndex + 1}</span>
                  <span className={s.thumb} style={{ background: stripe(thumb) }}>{pick.trackId === null ? '?' : ''}</span>
                  <span className={s.roundText}>
                    <span className={s.roundName}>{trackName(pick.trackId)}</span>
                    <span>
                      {isHost ? (
                        <button
                          type="button"
                          className={s.modeButton}
                          aria-label={`Change Round type for Round ${roundIndex + 1}`}
                          onClick={() => onPickRoundSlot(roundIndex, pick.trackId, nextRoundType(pick.roundType, true))}
                        >
                          <Chip tone={pick.roundType === null ? 'any' : MODE_TONE[pick.roundType]}>
                            {pick.roundType === null ? 'ANY MODE' : roundTypeLabel(pick.roundType).toUpperCase()}
                          </Chip>
                        </button>
                      ) : (
                        <Chip tone={pick.roundType === null ? 'any' : MODE_TONE[pick.roundType]}>
                          {pick.roundType === null ? 'ANY MODE' : roundTypeLabel(pick.roundType).toUpperCase()}
                        </Chip>
                      )}
                    </span>
                  </span>
                  {isHost && (
                    <button
                      type="button"
                      className={s.swap}
                      aria-label={`Change Track for Round ${roundIndex + 1}`}
                      disabled={tracks === null || tracks.length === 0}
                      onClick={() => onPickRoundSlot(roundIndex, nextTrackAfter(pick.trackId, true), pick.roundType)}
                    ><SwapIcon /></button>
                  )}
                </div>
              );
            })}

            {/* One more Round is exactly one more on the Match length the server bounds. */}
            {isHost && (
              <button
                type="button"
                className={s.addRound}
                disabled={lobby.matchLength >= MAX_MATCH_LENGTH}
                onClick={() => onSetMatchLength(lobby.matchLength + 1)}
              >+ ADD ROUND</button>
            )}
          </div>

          <p className={s.roundFacts}>
            Time Limit {formatRoundClock(lobby.timeLimitMs)}
            {/* Meaningless in a Race, which never reads the Survivor Target. */}
            {lobby.roundType === 'survival' &&
              ` · last ${lobby.survivorTarget} ${lobby.survivorTarget === 1 ? 'Player' : 'Players'} standing`}
          </p>

          {!isHost && <p className={s.hint}>Only the host picks the Track.</p>}

          {/*
            The server's own reason this Lobby can't start (M5 ticket 07) —
            shown to everyone, not only to the host holding the disabled
            button, since on a Track with no Finish Zone the wait would
            otherwise look like the host simply not clicking.
          */}
          {lobby.startBlockedReason !== undefined && <p className={s.blocked}>{lobby.startBlockedReason}</p>}

          <div className={s.setupFoot}>
            {/* Every future slot back to "the server draws it" — Round 1 is loaded, and stays put. */}
            <button
              type="button"
              className={s.ghost}
              disabled={!isHost || lobby.roundPicks.length === 0}
              onClick={() => lobby.roundPicks.forEach((_, i) => onPickRoundSlot(i + 1, null, null))}
            >SHUFFLE ALL</button>
            <button
              type="button"
              className={s.ghost}
              disabled={!isHost}
              onClick={() => setBrowsing(true)}
            >BROWSE TRACKS</button>
          </div>
        </Panel>

        {isHost ? (
          <JellyButton
            className={s.start}
            disabled={!allReady(lobby.players) || lobby.startBlockedReason !== undefined}
            kicker={`${lobby.matchLength} ${lobby.matchLength === 1 ? 'ROUND' : 'ROUNDS'} · ${readyCount}/${lobby.players.length} READY`}
            sound="confirm"
            onClick={onStart}
          >START MATCH</JellyButton>
        ) : (
          <p className={s.hint}>Waiting for the host to start…</p>
        )}
      </div>
    </Stage>
  );
}
