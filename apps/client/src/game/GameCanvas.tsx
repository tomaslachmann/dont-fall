import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { ResultsRow } from "@dont-fall/shared";
import { Button } from "@dont-fall/ui";
import type { ExitReason, GameHandle, LobbySnapshot } from "../game.js";
import { LobbyScreen } from "../screens/LobbyScreen.js";
import { ResultsScreen } from "../screens/ResultsScreen.js";
import styles from "./GameCanvas.module.css";

export interface GameCanvasProps {
  trackId?: string;
  onMatchEnd?: () => void;
  onExit?: (reason: ExitReason) => void;
}

/**
 * The boundary ADR 0008 and M4 ticket 01 prepared: takes a config in, hands
 * the game its own React-untouched div to mount into, and reports
 * match-end/exit back out. Renders a plain div; the game loop never runs
 * through React.
 */
export function GameCanvas({ trackId, onMatchEnd, onExit }: GameCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<GameHandle | null>(null);
  const [bootError, setBootError] = useState<Error | null>(null);
  const [exitReason, setExitReason] = useState<ExitReason | null>(null);
  const [lobby, setLobby] = useState<LobbySnapshot | null>(null);
  const [results, setResults] = useState<ResultsRow[] | null>(null);
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
    import("../game.js")
      .then(({ startGame }) =>
        startGame({
          mount: mountRef.current!,
          ...(trackId === undefined ? {} : { trackId }),
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
          // M4 ticket 07: the Lobby renders as a React overlay on top of
          // this already-connected, already-rendering canvas, the same way
          // the Countdown overlay reads `phase` (ADR 0040).
          onLobbyState: (state) => setLobby(state),
          // M4 ticket 08: same overlay shape as the Lobby above, shown
          // instead of it while `phase === "RESULTS"`.
          onResults: (rows) => setResults(rows),
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
      setResults(null);
    };
  }, [trackId]);

  if (bootError) {
    return (
      <div className={styles.notice}>
        <p>DON&apos;T FALL — failed to connect</p>
        <p className={styles.detail}>{bootError.message}</p>
        <Button variant="secondary" onClick={() => navigate("/")}>
          Back to menu
        </Button>
      </div>
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
          onStart={() => handleRef.current?.start()}
        />
      )}
      {lobby && lobby.phase === "RESULTS" && results && (
        <ResultsScreen
          results={results}
          isHost={lobby.hostId === lobby.myId}
          onReturnToLobby={() => handleRef.current?.returnToLobby()}
        />
      )}
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
