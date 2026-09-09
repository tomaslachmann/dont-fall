import { useEffect, useState } from "react";
import { allReady, MAX_MATCH_LENGTH, MIN_MATCH_LENGTH, NICKNAME_MAX_LENGTH, ROUND_TYPES, roundTypeLabel, type RoundType } from "@dont-fall/shared";
import { Avatar, Button, Card, HostBadge, LiveOverlay, Panel, Row, Toggle } from "@dont-fall/ui";
import type { LobbySnapshot } from "../game/index.js";
import { formatRoundClock } from "../lib/roundTimer.js";
import { resolveEndpoints } from "../lib/connection.js";
import styles from "./LobbyScreen.module.css";

export interface LobbyScreenProps {
  lobby: LobbySnapshot;
  onSetNickname: (nickname: string) => void;
  onSetReady: (ready: boolean) => void;
  onSelectTrack: (trackId: string) => void;
  onSetRoundType: (roundType: RoundType) => void;
  /** Host-only: sets this Match's length (M7 ticket 05, ADR 0049). */
  onSetMatchLength: (matchLength: number) => void;
  /** Host-only: picks (or clears, passing `null`/`null`) a future Round's slot (M7 ticket 05). */
  onPickRoundSlot: (roundIndex: number, trackId: string | null, roundType: RoundType | null) => void;
  onStart: () => void;
}

interface TrackListing {
  id: string;
  name: string | null;
}

/** First 1-2 letters of a nickname, upper-cased — `<Avatar>` never gets a photo. */
const initials = (nickname: string): string => {
  const words = nickname.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
};

/**
 * The Lobby overlaying an already-connected, already-rendering
 * `<GameCanvas>` (M4 ticket 07, ADR 0040) — the same "content over a live
 * scene" shape the Countdown overlay uses. `isSceneLive={false}` on
 * `<LiveOverlay>` because the real live scene is the actual game behind
 * this, not the placeholder backdrop that prop paints for a context with
 * no real one — the backdrop stays clear and the real render shows through.
 */
export function LobbyScreen({
  lobby,
  onSetNickname,
  onSetReady,
  onSelectTrack,
  onSetRoundType,
  onSetMatchLength,
  onPickRoundSlot,
  onStart,
}: LobbyScreenProps) {
  const me = lobby.players.find((p) => p.id === lobby.myId);
  const isHost = lobby.hostId === lobby.myId;
  const [nicknameDraft, setNicknameDraft] = useState(me?.nickname ?? "");
  const [tracks, setTracks] = useState<TrackListing[] | null>(null);

  // Only the host ever picks a Track, so only the host pays for the fetch.
  useEffect(() => {
    if (!isHost) return;
    let cancelled = false;
    const { trackServiceUrl } = resolveEndpoints(location.hostname);
    fetch(`${trackServiceUrl}/tracks`)
      .then((res) => res.json())
      .then((body: TrackListing[]) => {
        if (!cancelled) setTracks(body);
      })
      .catch((err: unknown) => console.error("DON'T FALL: could not list Tracks for the Lobby", err));
    return () => {
      cancelled = true;
    };
  }, [isHost]);

  const submitNickname = (): void => {
    if (nicknameDraft.trim().length > 0) onSetNickname(nicknameDraft);
  };

  return (
    <LiveOverlay isSceneLive={false}>
      <div className={styles.lobby}>
        <h1 className={styles.title}>Lobby</h1>

        <Panel className={styles.column}>
          <h2 className={styles.heading}>Players</h2>
          {lobby.players.map((player, index) => {
            const isOwnRow = player.id === lobby.myId;
            return (
              <Row
                key={player.id}
                surface="card"
                isHost={player.id === lobby.hostId}
                isOwnRow={isOwnRow}
                enterIndex={index}
                leading={<Avatar initials={initials(player.nickname)} isHost={player.id === lobby.hostId} active />}
                label={
                  <>
                    {player.nickname}
                    {player.id === lobby.hostId && (
                      <HostBadge className={[styles.hostBadge].filter(Boolean).join(" ")} />
                    )}
                  </>
                }
                trailing={
                  isOwnRow ? (
                    <Toggle checked={player.ready} onChange={onSetReady} />
                  ) : (
                    <Toggle checked={player.ready} readOnly aria-label={`${player.nickname} is${player.ready ? "" : " not"} ready`} />
                  )
                }
              />
            );
          })}
        </Panel>

        <Panel className={styles.column}>
          <h2 className={styles.heading}>Your nickname</h2>
          <div className={styles.nicknameRow}>
            <input
              className={styles.nicknameInput}
              value={nicknameDraft}
              maxLength={NICKNAME_MAX_LENGTH}
              onChange={(e) => setNicknameDraft(e.target.value)}
              onBlur={submitNickname}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitNickname();
              }}
            />
          </div>

          <h2 className={styles.heading}>Match length</h2>
          {isHost ? (
            <div className={styles.matchLengthRow}>
              <Button
                variant="secondary"
                aria-label="Fewer Rounds"
                disabled={lobby.matchLength <= MIN_MATCH_LENGTH}
                onClick={() => onSetMatchLength(lobby.matchLength - 1)}
              >
                −
              </Button>
              <span className={styles.matchLengthValue}>
                {lobby.matchLength} {lobby.matchLength === 1 ? "Round" : "Rounds"}
              </span>
              <Button
                variant="secondary"
                aria-label="More Rounds"
                disabled={lobby.matchLength >= MAX_MATCH_LENGTH}
                onClick={() => onSetMatchLength(lobby.matchLength + 1)}
              >
                +
              </Button>
            </div>
          ) : (
            <p className={styles.trackHint}>
              {lobby.matchLength} {lobby.matchLength === 1 ? "Round" : "Rounds"}
            </p>
          )}

          <h2 className={styles.heading}>Round</h2>
          {/*
            Everyone sees the Round type, host or not (M5 ticket 07) — only
            the host can change it. Rendered as the same row of choices
            either way rather than as a picker for one Player and a sentence
            for everyone else, so what the Lobby agreed on reads the same to
            all of them.
          */}
          <div className={styles.roundTypes} role="group" aria-label="Round type">
            {ROUND_TYPES.map((type) => (
              <Card
                key={type}
                className={[styles.roundTypeCard, type === lobby.roundType && styles.roundTypeCardSelected]
                  .filter(Boolean)
                  .join(" ")}
                aria-pressed={type === lobby.roundType}
                disabled={!isHost}
                onClick={() => onSetRoundType(type)}
              >
                {roundTypeLabel(type)}
              </Card>
            ))}
          </div>
          <p className={styles.roundFacts}>
            Time Limit {formatRoundClock(lobby.timeLimitMs)}
            {/* Meaningless in a Race, which never reads the Survivor Target. */}
            {lobby.roundType === "survival" &&
              ` · last ${lobby.survivorTarget} ${lobby.survivorTarget === 1 ? "Player" : "Players"} standing`}
          </p>

          <h2 className={styles.heading}>Track</h2>
          {isHost ? (
            <div className={styles.trackPicker}>
              {tracks === null && <p className={styles.trackHint}>Loading Tracks…</p>}
              {tracks?.map((track) => (
                <Card
                  key={track.id}
                  className={[styles.trackCard, track.id === lobby.trackId && styles.trackCardSelected]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => onSelectTrack(track.id)}
                >
                  {track.name ?? track.id}
                </Card>
              ))}
            </div>
          ) : (
            <p className={styles.trackHint}>Only the host picks the Track.</p>
          )}

          {lobby.roundPicks.length > 0 && (
            <>
              <h2 className={styles.heading}>Upcoming Rounds</h2>
              {/*
                Round 1 is whatever Track/Round-type panels above already
                say — this only covers Rounds 2..matchLength (M7 ticket 05,
                ADR 0049). A slot left "Random" is drawn by the server at
                the moment that Round actually starts — never shown here
                before then, "do not reveal a drawn Track early."
              */}
              <div className={styles.upcomingRounds}>
                {lobby.roundPicks.map((pick, i) => {
                  const roundIndex = i + 1; // 0-based; index 0 is Round 2
                  return (
                    <div key={roundIndex} className={styles.upcomingRound}>
                      <span className={styles.upcomingRoundLabel}>Round {roundIndex + 1}</span>
                      {isHost ? (
                        <>
                          <select
                            className={styles.upcomingRoundSelect}
                            value={pick.trackId ?? ""}
                            disabled={tracks === null}
                            onChange={(e) => onPickRoundSlot(roundIndex, e.target.value.length > 0 ? e.target.value : null, pick.roundType)}
                          >
                            <option value="">Random Track</option>
                            {tracks?.map((track) => (
                              <option key={track.id} value={track.id}>
                                {track.name ?? track.id}
                              </option>
                            ))}
                          </select>
                          <select
                            className={styles.upcomingRoundSelect}
                            value={pick.roundType ?? ""}
                            onChange={(e) =>
                              onPickRoundSlot(roundIndex, pick.trackId, e.target.value.length > 0 ? (e.target.value as RoundType) : null)
                            }
                          >
                            <option value="">Random type</option>
                            {ROUND_TYPES.map((type) => (
                              <option key={type} value={type}>
                                {roundTypeLabel(type)}
                              </option>
                            ))}
                          </select>
                        </>
                      ) : (
                        <span className={styles.trackHint}>
                          {pick.trackId ?? "Random Track"} · {pick.roundType ? roundTypeLabel(pick.roundType) : "Random type"}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/*
            The server's own reason this Lobby can't start (M5 ticket 07) —
            shown to everyone, not only to the host holding the disabled
            button, since on a Track with no Finish Zone the wait would
            otherwise look like the host simply not clicking.
          */}
          {lobby.startBlockedReason !== undefined && <p className={styles.blocked}>{lobby.startBlockedReason}</p>}

          {isHost ? (
            <Button
              className={styles.startButton}
              disabled={!allReady(lobby.players) || lobby.startBlockedReason !== undefined}
              onClick={onStart}
            >
              Start
            </Button>
          ) : (
            <p className={styles.trackHint}>Waiting for the host to start…</p>
          )}
        </Panel>
      </div>
    </LiveOverlay>
  );
}
