import { useEffect, useState } from "react";
import { allReady, NICKNAME_MAX_LENGTH, ROUND_TYPES, roundTypeLabel, type RoundType } from "@dont-fall/shared";
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
export function LobbyScreen({ lobby, onSetNickname, onSetReady, onSelectTrack, onSetRoundType, onStart }: LobbyScreenProps) {
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
