import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@dont-fall/ui";
import type { ExitReason, GameHandle, LobbySnapshot, StandingsSnapshot } from "../game/index.js";
import type { PracticeSnapshot } from "../game/practice.js";
import { LoadingScreen } from "../screens/LoadingScreen.js";
import { LobbyScreen } from "../screens/LobbyScreen.js";
import { PracticeHud } from "../screens/PracticeHud.js";
import { StandingsScreen } from "../screens/StandingsScreen.js";
import styles from "./GameCanvas.module.css";

export interface GameCanvasProps {
  trackId?: string;
  /**
   * Free-roam practice instead of a Match (m8.1 ticket 01): the game boots
   * a local session (`practice: true` through to `startGame`), renders the
   * practice hint bar instead of every match overlay, and never opens a
   * socket. Requires `trackId` — the boot reports it as an error otherwise.
   */
  practice?: boolean;
  onMatchEnd?: () => void;
  onExit?: (reason: ExitReason) => void;
}

/**
 * The boundary ADR 0008 and M4 ticket 01 prepared: takes a config in, hands
 * the game its own React-untouched div to mount into, and reports
 * match-end/exit back out. Renders a plain div; the game loop never runs
 * through React.
 */
export function GameCanvas({ trackId, practice, onMatchEnd, onExit }: GameCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<GameHandle | null>(null);
  const [bootError, setBootError] = useState<Error | null>(null);
  const [exitReason, setExitReason] = useState<ExitReason | null>(null);
  const [lobby, setLobby] = useState<LobbySnapshot | null>(null);
  const [standings, setStandings] = useState<StandingsSnapshot | null>(null);
  const [practiceState, setPracticeState] = useState<PracticeSnapshot | null>(null);
  // Whether this Player has already clicked Ready on the current Standings
  // (M7 ticket 11, ADR 0051) — local only, nothing server-replicated backs
  // it (the server's own per-Round `standingsReady` set is what actually
  // gates the Match; this just decides which Screen this client itself
  // shows). Reset the moment RESULTS ends, so a later Round's Standings
  // starts fresh rather than skipping straight to Loading.
  const [readyForNextRound, setReadyForNextRound] = useState(false);
  useEffect(() => {
    if (lobby?.phase !== "RESULTS") setReadyForNextRound(false);
  }, [lobby?.phase]);
  const navigate = useNavigate();

  // Latest-ref, not a dependency: onMatchEnd/onExit are typically a fresh
  // closure every render, and re-running the boot effect over an *identity*
  // change would tear down and reboot a running Match for no reason. Only
  // `trackId` — a different Track to play — should do that.
  const onMatchEndRef = useRef(onMatchEnd);
  onMatchEndRef.current = onMatchEnd;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  useEffect(() => {
    let cancelled = false;

    // Dynamic, not static: the menu should not pay for the renderer, the
    // physics WASM, or the Character model (ticket 06's own requirement).
    import("../game/index.js")
      .then(({ startGame }) =>
        startGame({
          mount: mountRef.current!,
          ...(trackId === undefined ? {} : { trackId }),
          ...(practice ? { practice: true as const } : {}),
          // The whole React surface of a practice session (m8.1 ticket 03)
          // is this one snapshot — raised at boot and on the finish
          // crossing, never for anything else. Never wired in a Match;
          // `onLobbyState`/`onStandings` below are never wired in practice.
          ...(practice ? { onPracticeState: (snapshot: PracticeSnapshot) => setPracticeState(snapshot) } : {}),
          onMatchEnd: () => onMatchEndRef.current?.(),
          // The game freezes on its own last frame and shows its own
          // "reload to rejoin" HUD message on exit (ADR 0011 — no reconnect
          // in M2). Recorded here, not acted on immediately: calling the
          // parent's onExit straight away would navigate away and unmount
          // this the instant the socket closes, tearing the frozen message
          // down before the player ever sees it — "stopping the game is
          // [the shell's] call, not [the game's]" (game.ts's own comment on
          // this exact hand-off). The player leaves on their own click
          // instead, via the banner below.
          onExit: (reason) => setExitReason(reason),
          // M4 ticket 07: the Lobby Screen mounts alongside this
          // already-connected canvas but never shows it (ADR 0051, ticket
          // 09) — the connection stays live underneath regardless.
          onLobbyState: (state) => setLobby(state),
          // M4 ticket 08 / M7 ticket 06/12: same shape as the Lobby above,
          // shown instead of it while `phase === "RESULTS"`.
          onStandings: (snapshot) => setStandings(snapshot),
        }),
      )
      .then((bootedHandle) => {
        if (cancelled) {
          bootedHandle.stop(); // unmounted while the boot was still in flight — leave nothing behind
          return;
        }
        handleRef.current = bootedHandle;
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setBootError(err instanceof Error ? err : new Error(String(err)));
      });

    return () => {
      cancelled = true;
      handleRef.current?.stop();
      handleRef.current = null;
      setLobby(null);
      setStandings(null);
      setPracticeState(null);
      setReadyForNextRound(false);
    };
  }, [trackId, practice]);

  // Leaving a practice session is the existing `onExit` path (m8.1 ticket
  // 03) — no new exit mechanism. The teardown above already ran on unmount
  // (`stop()` frees the sim, stage, listeners and canvas), so this only
  // asks the shell to navigate away. "disconnected" is the sole existing
  // `ExitReason`: a practice session has no connection to lose, the value
  // only tells the shell to go back to the menu.
  const exitPractice = (): void => {
    if (onExitRef.current) onExitRef.current("disconnected");
    else navigate("/");
  };

  // The Standings Screen's own "Main Menu" action at Match end (M7 ticket
  // 12, ADR 0051) — a voluntary leave, independent of anyone else still
  // sitting on the same Standings. Unmounting (below) tears the game down
  // through the same effect cleanup `exitPractice` relies on; this just
  // asks the shell to navigate, giving `onMatchEnd` its first real caller
  // (declared since M4 ticket 01, never raised until now).
  const goToMainMenu = (): void => {
    if (onMatchEndRef.current) onMatchEndRef.current();
    else navigate("/");
  };

  if (bootError) {
    return (
      <div className={styles.notice}>
        <p>{practice ? "DON\u2019T FALL — failed to load Track" : "DON\u2019T FALL — failed to connect"}</p>
        <p className={styles.detail}>{bootError.message}</p>
        <Button variant="secondary" onClick={() => navigate("/")}>
          Back to menu
        </Button>
      </div>
    );
  }

  if (practice) {
    return (
      <>
        <div ref={mountRef} className={styles.mount} />
        {practiceState && (
          <PracticeHud trackName={practiceState.trackName} finished={practiceState.finished} onBack={exitPractice} />
        )}
      </>
    );
  }

  return (
    <>
      <div ref={mountRef} className={styles.mount} />
      {lobby && lobby.phase === "LOBBY" && (
        <LobbyScreen
          lobby={lobby}
          onSetNickname={(nickname) => handleRef.current?.setNickname(nickname)}
          onSetReady={(ready) => handleRef.current?.setReady(ready)}
          onSelectTrack={(id) => handleRef.current?.selectTrack(id)}
          onSetRoundType={(roundType) => handleRef.current?.setRoundType(roundType)}
          onSetMatchLength={(matchLength) => handleRef.current?.setMatchLength(matchLength)}
          onPickRoundSlot={(roundIndex, trackId, roundType) => handleRef.current?.pickRoundSlot(roundIndex, trackId, roundType)}
          onStart={() => handleRef.current?.start()}
        />
      )}
      {lobby &&
        lobby.phase === "RESULTS" &&
        standings &&
        (readyForNextRound ? (
          <LoadingScreen />
        ) : (
          <StandingsScreen
            results={standings.results}
            standings={standings.standings}
            winners={standings.winners}
            roundsRemaining={standings.roundsRemaining}
            onStandingsReady={() => {
              setReadyForNextRound(true);
              handleRef.current?.standingsReady();
            }}
            onMainMenu={goToMainMenu}
          />
        ))}
      {exitReason && (
        <div className={styles.exitBanner}>
          <Button variant="secondary" onClick={() => onExitRef.current?.(exitReason)}>
            Back to menu
          </Button>
        </div>
      )}
    </>
  );
}
