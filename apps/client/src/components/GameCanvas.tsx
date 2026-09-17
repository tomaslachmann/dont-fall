import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ASSET_PLACEMENT_MODULES, MODULE_LIBRARY, STANDINGS_READY_TIMEOUT_MS, countCheckpoints } from "@dont-fall/shared";
import { Button } from "@dont-fall/ui";
import type { ExitReason, GameHandle, StandingsSnapshot } from "../game/index.js";
import type { HitTakenEvent } from "../game/hitTaken.js";
import type { PracticeSnapshot } from "../game/practice.js";
import type { RunEndEvent } from "../game/runEnd.js";
import type { SpectateSnapshot } from "../game/spectator.js";
import { ConnectionError } from "../lib/errors.js";
import { browserStorage, resolvePerfFlag } from "../lib/perfFlag.js";
import { readGraphicsQuality } from "../lib/graphicsQuality.js";
import { setGameActive } from "../lib/gamePresence.js";
import { skinForPlayerId } from "../lib/avatarSkins.js";
import { useBeanBalance, useBettingState, usePlaceBet } from "../lib/hooks/useBetting.js";
import { trackThumbnailUrl } from "../lib/api/tracks.js";
import { useTrackDetail } from "../lib/hooks/useTrackDetail.js";
import { useTrackList } from "../lib/hooks/useTrackList.js";
import { formatRaceTime, formatRoundClock, formatSurvived } from "../lib/utils/roundTimer.js";
import { ordinal, toStandingRows } from "../lib/matchView.js";
import type { LobbyConnection, LobbySnapshot } from "../lib/socket/lobbyConnection.js";
import BetweenRounds from "../screens/BetweenRounds.js";
import Countdown from "../screens/Countdown.js";
import FinishedOrOut from "../screens/FinishedOrOut.js";
import HitFeedback from "../screens/HitFeedback.js";
import { LoadingScreen } from "../screens/LoadingScreen.js";
import Spectator from "../screens/Spectator.js";
import { PracticeHud } from "../screens/PracticeHud.js";
import styles from "./GameCanvas.module.css";

export interface GameCanvasProps {
  trackId?: string;
  /**
   * The port of the Lobby the broker sent this Player to (ADR 0054) —
   * `/lobby?port=` — forwarded straight to the game, which opens its socket
   * against it. Omitted, the game falls back to the fixed-port standalone
   * Match server. Ignored when `connection` is present (the socket is
   * already open).
   */
  serverPort?: number;
  /**
   * A live shell-owned connection to boot the game on top of (ADR 0056) —
   * the same socket the Lobby Screen already used, so Player identity
   * survives the LOBBY → COUNTDOWN handoff. The game attaches its
   * snapshot/sim feed to it and never closes it; the route still owns that
   * lifetime. Absent, the game dials its own socket as before (standalone /
   * `?track=` playtest).
   */
  connection?: LobbyConnection;
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
 * How long the Countdown overlay holds on green GO! after the Round starts.
 * The server flips COUNTDOWN → RUNNING on the release tick, so without this
 * hold the overlay would unmount exactly when its final beat lands and GO!
 * would never be seen. Display-only: the Round is live underneath from the
 * first RUNNING snapshot, hold or not.
 */
const GO_HOLD_MS = 1000;
/**
 * How long the incoming-Hit flash stays up per landing (M9 ticket 09) — one
 * beat, the GO! hold's own cadence. Display-only; the sim never waits on it.
 */
const HIT_FLASH_MS = 1000;

/**
 * The boundary ADR 0008 and M4 ticket 01 prepared: takes a config in, hands
 * the game its own React-untouched div to mount into, and reports
 * match-end/exit back out. Renders a plain div; the game loop never runs
 * through React.
 */
export function GameCanvas({ trackId, serverPort, connection, practice, onMatchEnd, onExit }: GameCanvasProps) {
  // While a Match is mounted a game owns the screen — the global social
  // alerts step aside for it (a Lobby invite returns once the game is gone,
  // unless the Player answered it first). A practice boot is not a game
  // start: the alerts stay up over free-roam.
  useEffect(() => {
    if (practice) return;
    setGameActive(true);
    return () => setGameActive(false);
  }, [practice]);
  const mountRef = useRef<HTMLDivElement | null>(null);
  // The performance overlay (M13 ticket 01): `?perf=1`, or remembered from an
  // earlier visit — read once per mount, so the game never reboots over it.
  const [searchParams] = useSearchParams();
  const [perf] = useState(() => resolvePerfFlag(searchParams, browserStorage()));
  // Graphics quality (ADR 0079): the device's stored level, read once per
  // mount; a change in Settings applies from the next game entry.
  const [graphicsQuality] = useState(() => readGraphicsQuality(browserStorage()));
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
  // Which Round just played / is playing — counted off COUNTDOWN entries,
  // since neither snapshot numbers its Rounds (roundResults order is Match
  // scope the shell never sees). Reset on LOBBY: a fresh Match in the same
  // mount starts counting over.
  const [roundNumber, setRoundNumber] = useState(0);
  const prevPhaseRef = useRef<string | null>(null);
  const prevTotalsRef = useRef(new Map<string, { score: number; placement: number }>());
  // Your run ended mid-Round (ticket 14) — the FinishedOrOut verdict's
  // facts, raised once per Round by the game. Cleared on the next COUNTDOWN
  // with everything else Round-scoped; the verdict itself only renders while
  // the Round is still RUNNING, so a stale event can never outlive it.
  const [runEnd, setRunEnd] = useState<RunEndEvent | null>(null);
  // Spectator Mode's facts (ticket 14) — who the camera follows, who is
  // still racing. `null` outside spectating; the panel additionally waits
  // for the verdict's SPECTATE unless there was never a run to end
  // (a mid-Match joiner spectates with no verdict before it).
  const [spectate, setSpectate] = useState<SpectateSnapshot | null>(null);
  const [askedSpectate, setAskedSpectate] = useState(false);
  // Local stopwatch anchor for the panel's ALIVE FOR — set on RUNNING entry
  // (display-only elapsed; the server owns every clock that matters).
  const [roundStartedAt, setRoundStartedAt] = useState<number | null>(null);
  // When this RESULTS began, for the auto-start countdown (local clock —
  // the server owns the timeout, this only renders its remainder).
  const [resultsAt, setResultsAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // The Countdown overlay holds on green GO! for one beat after release
  // (GO_HOLD_MS) — set on the COUNTDOWN → RUNNING edge, cleared by the timer
  // below. Display-only, like everything else phase-edged here.
  const [showGo, setShowGo] = useState(false);
  // The incoming-Hit flash (M9 ticket 09) — the loop's `onHitTaken` event
  // plus a mount key, so a second landing while the first still shows
  // re-mounts (restarting the fx) instead of being swallowed by an
  // identical-state no-op. Cleared by the timer below, and on COUNTDOWN
  // entry with everything else round-scoped.
  const [hitTaken, setHitTaken] = useState<{ event: HitTakenEvent; key: number } | null>(null);
  const hitKeyRef = useRef(0);
  useEffect(() => {
    const phase = lobby?.phase ?? null;
    if (phase === "COUNTDOWN" && prevPhaseRef.current !== "COUNTDOWN") {
      setRoundNumber((n) => n + 1);
      setRunEnd(null);
      setAskedSpectate(false);
      setHitTaken(null);
    }
    if (phase === "RUNNING" && prevPhaseRef.current !== "RUNNING") {
      setRoundStartedAt(Date.now());
      setShowGo(true);
    }
    if (phase !== "RUNNING") setRoundStartedAt(null);
    if (phase === "LOBBY") {
      setRoundNumber(0);
      prevTotalsRef.current = new Map();
    }
    if (phase === "RESULTS") setResultsAt((prev) => prev ?? Date.now());
    else setResultsAt(null);
    prevPhaseRef.current = phase;
  }, [lobby?.phase]);
  useEffect(() => {
    if (resultsAt === null) return;
    const timer = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(timer);
  }, [resultsAt]);
  useEffect(() => {
    if (!showGo) return;
    const timer = setTimeout(() => setShowGo(false), GO_HOLD_MS);
    return () => clearTimeout(timer);
  }, [showGo]);
  useEffect(() => {
    if (!hitTaken) return;
    const timer = setTimeout(() => setHitTaken(null), HIT_FLASH_MS);
    return () => clearTimeout(timer);
  }, [hitTaken]);
  useEffect(() => {
    if (lobby?.phase !== "RESULTS" || standings === null) return;
    prevTotalsRef.current = new Map(
      standings.standings.map((row) => [row.id, { score: row.score, placement: row.placement }]),
    );
  }, [lobby?.phase, standings]);
  const trackDetail = useTrackDetail(practice ? undefined : lobby?.trackId);
  const trackList = useTrackList();
  // Ticket 14: the Spectator panel's board — polled only while the panel is
  // actually open (a Round nobody spectates spends no requests). The bean
  // balance rides along regardless: it is one short-lived GET per 15s, and
  // the panel wants it the instant it opens.
  const panelWanted =
    lobby?.phase === "RUNNING" && spectate !== null && (runEnd === null || askedSpectate) && !practice;
  const betting = useBettingState(lobby?.matchId, panelWanted ? roundNumber : undefined, panelWanted);
  const beanBalance = useBeanBalance();
  const placeBet = usePlaceBet();
  const totalCheckpoints = trackDetail ? countCheckpoints(trackDetail.track, { ...MODULE_LIBRARY, ...ASSET_PLACEMENT_MODULES }) : 0;
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
          ...(serverPort === undefined ? {} : { serverPort }),
          ...(connection === undefined ? {} : { connection }),
          ...(practice ? { practice: true as const } : {}),
          ...(perf ? { perf: true } : {}),
          graphicsQuality,
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
          // The Lobby phase itself is a pure React Screen on the route's own
          // connection (ADR 0056) — this only still reads `phase` to gate
          // the Standings overlay below.
          onLobbyState: (state) => setLobby(state),
          // M4 ticket 08 / M7 ticket 06/12: same shape as the Lobby above,
          // shown instead of it while `phase === "RESULTS"`.
          onStandings: (snapshot) => setStandings(snapshot),
          // Ticket 14: your run ended mid-Round (the verdict), and Spectator
          // Mode's facts (the panel) — same overlay discipline as the two
          // above, over the still-running game.
          onRunEnd: (event) => setRunEnd(event),
          // M9 ticket 09: your own Character took a Hit — the flash. Keyed
          // per landing (see `hitTaken` above), so back-to-back Hits replay
          // instead of extending one stale flash.
          onHitTaken: (event) => {
            hitKeyRef.current += 1;
            setHitTaken({ event, key: hitKeyRef.current });
          },
          onSpectate: (snapshot) => setSpectate(snapshot),
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
      setShowGo(false);
    };
  }, [trackId, serverPort, connection, practice, perf, graphicsQuality]);

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

  // A voluntary leave (the verdict's and Spectator panel's LEAVE) —
  // independent of anyone else still in the Match. Unmounting tears the game
  // down through the same effect cleanup `exitPractice` relies on; this just
  // asks the shell to navigate (`onMatchEnd`, declared since M4 ticket 01).
  const goToMainMenu = (): void => {
    if (onMatchEndRef.current) onMatchEndRef.current();
    else navigate("/");
  };

  // A Match boot that rejects is a connection failure: the app-wide
  // boundary renders it, not a per-component banner. Thrown during render,
  // where a boundary can catch it. A practice boot that rejects is a Track
  // that never loaded — no connection exists to blame, so the local banner
  // below stays (m8.1: a Track load error, not a connection error).
  if (bootError !== null && !practice) throw new ConnectionError(bootError.message);

  if (practice) {
    return (
      <>
        <div ref={mountRef} className={styles.mount} />
        {bootError !== null ? (
          <div className={styles.notice}>
            <p>DON&#8217;T FALL — failed to load Track</p>
            <p className={styles.detail}>{bootError.message}</p>
            <Button variant="secondary" onClick={() => navigate("/")}>
              Back to menu
            </Button>
          </div>
        ) : (
          practiceState && (
            <PracticeHud trackName={practiceState.trackName} finished={practiceState.finished} bindings={practiceState.bindings} onBack={exitPractice} />
          )
        )}
      </>
    );
  }

  // Derived view data — everything below reads snapshots, never computes
  // what the server owns. `myId` is the socket-bound identity (welcome),
  // absent in practice, where there is no Match and no "you".
  const myId = connection?.myId;
  const trackNameOf = (id: string): string => trackList?.find((t) => t.id === id)?.name ?? id;
  const standingRows = standings ? toStandingRows(standings.standings, prevTotalsRef.current, myId) : null;
  const confirmedCount = standings?.standings.filter((row) => row.confirmed).length ?? 0;
  const autoStartMs = resultsAt === null ? 0 : Math.max(0, STANDINGS_READY_TIMEOUT_MS - (nowMs - resultsAt));
  const autoStartLabel = `${Math.floor(autoStartMs / 60000)}:${String(Math.floor((autoStartMs % 60000) / 1000)).padStart(2, "0")}`;
  const myLobbyPlayer = lobby?.players.find((p) => p.id === myId);
  const lineOrder = myLobbyPlayer
    ? [myLobbyPlayer, ...(lobby?.players.filter((p) => p.id !== myId) ?? [])]
    : (lobby?.players ?? []);
  const nextPick = lobby ? lobby.roundPicks[roundNumber - 1] : undefined;
  const nextTrackName = nextPick?.trackId ? trackNameOf(nextPick.trackId) : "UNREVEALED";
  // The Round loader's screenshot (ADR 0085) — the same next Track
  // BetweenRounds names above, art only when its Revision captured one.
  const nextTrackThumbnail =
    nextPick?.trackId && trackList?.find((t) => t.id === nextPick.trackId)?.hasThumbnail
      ? trackThumbnailUrl(nextPick.trackId)
      : undefined;
  // The Match is over and its results are persisted (ADR 0059) — leave for
  // the results page, which unmounts this canvas (game, physics, socket)
  // behind the navigation. `?me=` names whose page it is; a standalone
  // playtest has no socket-bound identity, so it arrives unnamed.
  const matchOverId =
    lobby !== null && lobby.phase === "RESULTS" && standings !== null && !standings.roundsRemaining
      ? (lobby.matchOver?.matchId ?? null)
      : null;
  useEffect(() => {
    if (matchOverId === null) return;
    const me = myId === undefined ? "" : `?me=${encodeURIComponent(myId)}`;
    navigate(`/match/${encodeURIComponent(matchOverId)}${me}`, { replace: true });
  }, [matchOverId, myId, navigate]);

  // The Lobby Screen is not an overlay here anymore (ADR 0056): by the time
  // this mounts, the route has already moved past LOBBY on its own
  // connection. The overlays below are the designed match screens —
  // Countdown, FinishedOrOut, the incoming-Hit flash, the Spectator panel,
  // BetweenRounds mid-Match —
  // over the still-mounted game. Match end itself is not an overlay at all
  // (ADR 0059): a terminal RESULTS shows a saving notice until `matchOver`
  // lands, then navigates to the results page and unmounts.
  return (
    <>
      <div ref={mountRef} className={styles.mount} />
      {lobby && (lobby.phase === "COUNTDOWN" || (lobby.phase === "RUNNING" && showGo)) && !practice && trackDetail && (
        <div className={styles.screenOverlay}>
          <Countdown
            round={roundNumber}
            rounds={lobby.matchLength}
            track={(trackDetail.name ?? lobby.trackId).toUpperCase()}
            mode={lobby.roundType.toUpperCase()}
            gridSpot={myLobbyPlayer ? myLobbyPlayer.joinOrder + 1 : 1}
            field={lobby.players.length}
            checkpoints={totalCheckpoints}
            countdownMsLeft={lobby.phase === "COUNTDOWN" ? lobby.countdownMsLeft : 0}
            onTheLine={lineOrder.slice(0, 5).map((p) => skinForPlayerId(p.id))}
            othersOnTheLine={Math.max(0, lobby.players.length - 5)}
          />
        </div>
      )}
      {lobby && lobby.phase === "RUNNING" && runEnd && !askedSpectate && !practice && trackDetail && (
        <div className={styles.screenOverlay}>
          <FinishedOrOut
            outcomes={[
              {
                badge: runEnd.outcome === "finished" ? "FINISHED" : "KNOCKED OUT",
                result: runEnd.outcome === "finished" ? ordinal(runEnd.placement) : `#${runEnd.placement}`,
                ...(runEnd.outcome === "out" ? { out: true as const } : {}),
                stats:
                  runEnd.outcome === "finished"
                    ? [
                        { label: "TIME", value: formatRaceTime(runEnd.raceTimeMs ?? 0) },
                        { label: "POINTS", value: `+${Math.round(runEnd.points)}`, accent: true as const },
                      ]
                    : [
                        { label: "SURVIVED", value: formatSurvived(runEnd.survivedMs ?? 0) },
                        { label: "POINTS", value: `+${Math.round(runEnd.points)}`, accent: true as const },
                      ],
              },
            ]}
            position={runEnd.placement}
            field={runEnd.playerCount}
            checkpoints={totalCheckpoints}
            checkpointsDone={runEnd.outcome === "finished" ? totalCheckpoints : (runEnd.checkpointIndex ?? -1) + 1}
            nextRoundIn={formatRoundClock(lobby.timeLimitMs)}
            onSpectate={() => {
              setAskedSpectate(true);
              handleRef.current?.enterSpectate();
            }}
            onLeave={goToMainMenu}
          />
        </div>
      )}
      {/* M9 ticket 09: the incoming-Hit flash — a one-shot React overlay (ADR
          0060), keyed per landing so back-to-back Hits replay. RUNNING only,
          never in practice (no one there to Hit you). Above the verdict: a
          Hit that downs you off the edge can flash under either order, and
          the newer event reads on top. */}
      {lobby && lobby.phase === "RUNNING" && hitTaken && !practice && (
        <div className={styles.screenOverlay}>
          <HitFeedback
            key={hitTaken.key}
            {...(hitTaken.event.knockedDown ? { knockedDown: true as const } : {})}
          />
        </div>
      )}
      {lobby && spectate && panelWanted && (
        <div className={styles.screenOverlay}>
          <Spectator
            following={spectate.followingNickname}
            {...(spectate.followingId === null ? {} : { followingId: spectate.followingId })}
            followingSkin={skinForPlayerId(spectate.followingId ?? "me")}
            place={spectate.followedPlace === null ? "—" : `#${spectate.followedPlace}`}
            aliveFor={roundStartedAt === null ? "—" : formatSurvived(Date.now() - roundStartedAt)}
            beansLeft={spectate.beansLeft}
            round={`ROUND ${roundNumber} · ${lobby.roundType.toUpperCase()}`}
            yourExit={
              runEnd === null
                ? null
                : runEnd.outcome === "finished"
                  ? `YOU FINISHED ${ordinal(runEnd.placement)}`
                  : `YOU WENT OUT #${runEnd.placement}`
            }
            runners={spectate.runners
              .map((runner) => {
                const odds = betting?.runners.find((board) => board.playerId === runner.id)?.odds ?? null;
                return { id: runner.id, name: runner.nickname, skin: skinForPlayerId(runner.id), odds };
              })
              .map((runner, _, runners) => {
                const defined = runners.filter((other) => other.odds !== null);
                const best = defined.length === 0 ? null : Math.min(...defined.map((other) => other.odds!));
                const worst = defined.length === 0 ? null : Math.max(...defined.map((other) => other.odds!));
                return {
                  ...runner,
                  ...(best !== null && runner.odds === best ? { favourite: true as const } : {}),
                  ...(worst !== null && worst !== best && runner.odds === worst ? { longshot: true as const } : {}),
                };
              })}
            ticker={(() => {
              const latest = betting?.recentBets[0];
              if (!latest || !betting) return null;
              return {
                main: `${latest.nickname} STAKED ${latest.amount} ON ${latest.targetNickname}`.toUpperCase(),
                sub: `${betting.bettorCount} SPECTATORS BETTING`,
              };
            })()}
            closesIn={
              betting && betting.open ? formatRoundClock(Math.max(0, betting.closesAtMs - Date.now())) : null
            }
            balance={beanBalance}
            onFollow={(playerId) => handleRef.current?.spectateFollow(playerId)}
            onPrev={() => handleRef.current?.spectatePrev()}
            onNext={() => handleRef.current?.spectateNext()}
            onFreeCam={() => handleRef.current?.setFreeCam(!spectate.freeCam)}
            freeCam={spectate.freeCam}
            onStake={async (targetId, amount) => {
              await placeBet({ matchId: lobby.matchId, round: roundNumber, targetId, amount });
            }}
            onLeave={goToMainMenu}
          />
        </div>
      )}
      {lobby &&
        lobby.phase === "RESULTS" &&
        standings &&
        !practice &&
        (readyForNextRound ? (
          <LoadingScreen
            trackName={nextTrackName}
            {...(nextTrackThumbnail ? { thumbnailUrl: nextTrackThumbnail } : {})}
          />
        ) : standings.roundsRemaining ? (
          <div className={styles.screenOverlay}>
            <BetweenRounds
              round={roundNumber}
              rounds={lobby.matchLength}
              justPlayed={`${trackNameOf(lobby.trackId)} · ${lobby.roundType.toUpperCase()}`}
              standings={standingRows ?? []}
              nextTrack={nextTrackName}
              nextNote={nextPick?.trackId ? "" : "DRAWN AT MATCH START — REVEALED WHEN THE ROUND LOADS"}
              {...(nextPick?.roundType ? { nextMode: nextPick.roundType.toUpperCase() } : {})}
              autoStart={autoStartLabel}
              readyCount={confirmedCount}
              onReady={() => {
                setReadyForNextRound(true);
                handleRef.current?.standingsReady();
              }}
              onScoreboard={() =>
                navigate("/scoreboard", { state: { rows: standingRows ?? [], title: `AFTER ROUND ${roundNumber}` } })
              }
              onLeave={goToMainMenu}
            />
          </div>
        ) : (
          // Terminal RESULTS (ADR 0059): the server is saving (or just
          // saved) — the effect above navigates to the results page the
          // moment `matchOver` lands, unmounting this canvas behind it.
          <LoadingScreen label="Saving results…" />
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
