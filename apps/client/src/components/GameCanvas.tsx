import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ASSET_PLACEMENT_MODULES, MODULE_LIBRARY, UNTITLED_TRACK_NAME, countCheckpoints } from "@dont-fall/shared";
import { Button } from "@dont-fall/ui";
import type { ExitReason, GameHandle, StandingsSnapshot } from "../game/index.js";
import type { HitTakenEvent } from "../game/hitTaken.js";
import type { PracticeSnapshot } from "../game/practice.js";
import type { RoundHudSnapshot } from "../game/roundHud.js";
import type { RunEndEvent } from "../game/runEnd.js";
import type { SpectateSnapshot } from "../game/spectator.js";
import { ConnectionError } from "../lib/errors.js";
import { browserStorage } from "../lib/browserStorage.js";
import { readGraphicsQuality } from "../lib/graphicsQuality.js";
import { setGameActive } from "../lib/gamePresence.js";
import { placeVoices, speakingAccounts, useVoiceRoom } from "../lib/voice/session.js";
import { namesFromRoster, usePauseVoice } from "../lib/voice/usePauseVoice.js";
import { avatarLook, NO_AVATAR, type AvatarLook } from "../lib/avatar.js";
import { useBeanBalance, useBettingState, usePlaceBet } from "../lib/hooks/useBetting.js";
import { useTrackDetail } from "../lib/hooks/useTrackDetail.js";
import { useTrackList } from "../lib/hooks/useTrackList.js";
import { usePersonalBest } from "../lib/hooks/usePersonalBest.js";
import { thumbnailFor } from "../lib/trackArt.js";
import {
  formatRaceClock,
  formatRaceTime,
  formatRoundClock,
  formatSplit,
  formatSurvived,
} from "../lib/utils/roundTimer.js";
import { ordinal, toStandingRows } from "../lib/matchView.js";
import type { LobbyConnection, LobbySnapshot } from "../lib/socket/lobbyConnection.js";
import BetweenRounds from "../screens/BetweenRounds.js";
import Countdown from "../screens/Countdown.js";
import FinishedOrOut from "../screens/FinishedOrOut.js";
import Grabbed from "../screens/Grabbed.js";
import HitFeedback from "../screens/HitFeedback.js";
import HoldingPanel from "../screens/HoldingPanel.js";
import PauseMenu from "../screens/PauseMenu.js";
import Settings from "../screens/Settings.js";
import { useGameplaySettings } from "../lib/hooks/useGameplaySettings.js";
import { LoadingScreen, RoundLoader } from "../screens/LoadingScreen.js";
import Spectator from "../screens/Spectator.js";
import SpeakingRow from "../screens/SpeakingRow.js";
import { PracticeHud } from "../screens/PracticeHud.js";
import RaceHUD from "../screens/RaceHUD.js";
import Scoreboard from "../screens/Scoreboard.js";
import SurvivalHud from "../screens/SurvivalHud.js";
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
   * The route's own latest Lobby snapshot, the one that handed the socket over
   * (ADR 0056). The Round loader reads it until the game raises its own, so
   * it knows its Track from the first frame instead of after the game module
   * has loaded (ADR 0105).
   */
  lobbyAtHandover?: LobbySnapshot | null;
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
 * How long the incoming-Hit flash stays up per landing (M9 ticket 09).
 * Display-only; the sim never waits on it. A Hit that leaves you standing is
 * a brief red tint; a knockout holds long enough for its crack to paint, sit
 * and fade (2026-09-18) — the two match `HitFeedback.module.css`'s own
 * `tint` and `crackFade`.
 */
const HIT_FLASH_MS = 600;
const KNOCKDOWN_FLASH_MS = 1600;

/** FinishedOrOut's OFF YOUR PB plate: seconds to a tenth, signed, and a warning only when slower. */
const offYourPb = (deltaMs: number): { label: string; value: string; warn?: true } => ({
  label: "OFF YOUR PB",
  value: `${deltaMs > 0 ? "+" : "-"}${(Math.abs(deltaMs) / 1000).toFixed(1)}`,
  ...(deltaMs > 0 ? { warn: true as const } : {}),
});

/**
 * The boundary ADR 0008 and M4 ticket 01 prepared: takes a config in, hands
 * the game its own React-untouched div to mount into, and reports
 * match-end/exit back out. Renders a plain div; the game loop never runs
 * through React.
 */
export function GameCanvas({ trackId, serverPort, connection, lobbyAtHandover, practice, onMatchEnd, onExit }: GameCanvasProps) {
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
  const prevPhaseRef = useRef<string | null>(null);
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
  // The Round HUD's facts (ADR 0088) — raised by the game only when a drawn
  // value changed, `null` outside RUNNING or without a Character in the Round.
  const [roundHud, setRoundHud] = useState<RoundHudSnapshot | null>(null);
  // Who is talking (ADR 0111). Edges only: a frame of audio never reaches React.
  const voice = useVoiceRoom();
  // Whether this client's own world is built (ADR 0089). The Round waits for
  // every client's, but this is the half only this client can know: until it
  // is true there is nothing under the loading Screen worth showing.
  const [worldReady, setWorldReady] = useState(false);
  const [askedSpectate, setAskedSpectate] = useState(false);
  // The auto-start countdown's clock — ticks only while Standings are up; the
  // deadline itself is the server's (ADR 0110).
  const [nowMs, setNowMs] = useState(() => Date.now());
  // The full table behind BetweenRounds' SCOREBOARD, over the game rather
  // than on its own route: leaving the route would close the socket and the
  // Player with it (ADR 0110).
  const [scoreboardOpen, setScoreboardOpen] = useState(false);
  // The pause sheet (ADR 0110): opened by letting go of the mouse mid-Match or
  // by Esc, over the Round, which runs on. ALL SETTINGS opens Settings in place.
  const [paused, setPaused] = useState(false);
  const [allSettings, setAllSettings] = useState(false);
  const [gameplay, setGameplay] = useGameplaySettings();
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
      setRunEnd(null);
      setAskedSpectate(false);
      setHitTaken(null);
    }
    if (phase === "RUNNING" && prevPhaseRef.current !== "RUNNING") setShowGo(true);
    if (phase !== "RESULTS") setScoreboardOpen(false);
    if (phase === "LOBBY" || phase === "RESULTS") {
      setPaused(false);
      setAllSettings(false);
    }
    prevPhaseRef.current = phase;
  }, [lobby?.phase]);
  useEffect(() => {
    if (lobby?.phase !== "RESULTS") return;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(timer);
  }, [lobby?.phase]);
  useEffect(() => {
    if (!showGo) return;
    const timer = setTimeout(() => setShowGo(false), GO_HOLD_MS);
    return () => clearTimeout(timer);
  }, [showGo]);
  useEffect(() => {
    if (!hitTaken) return;
    const timer = setTimeout(() => setHitTaken(null), hitTaken.event.knockedDown ? KNOCKDOWN_FLASH_MS : HIT_FLASH_MS);
    return () => clearTimeout(timer);
  }, [hitTaken]);
  const trackDetail = useTrackDetail(practice ? undefined : lobby?.trackId);
  const trackList = useTrackList();
  // Ticket 14: the Spectator panel's board — polled only while the panel is
  // actually open (a Round nobody spectates spends no requests). The bean
  // balance rides along regardless: it is one short-lived GET per 15s, and
  // the panel wants it the instant it opens.
  const panelWanted =
    lobby?.phase === "RUNNING" && spectate !== null && (runEnd === null || askedSpectate) && !practice;
  // Which Round is playing, or just played while in RESULTS — the server's
  // own number (ADR 0110), `0` before the first Round.
  const roundNumber = lobby?.round ?? 0;
  const betting = useBettingState(lobby?.matchId, panelWanted ? roundNumber : undefined, panelWanted);
  const beanBalance = useBeanBalance();
  const placeBet = usePlaceBet();
  const personalBestMs = usePersonalBest(practice ? undefined : lobby?.trackId, roundNumber);
  // The Round loader (ADR 0089): up while this client is still building its
  // world, and while the server holds LOADING for everyone else's. The Track
  // it names is the one the Round runs on, art and all (ADR 0085). Its name
  // and picture come off the listing sign-in already loaded (ADR 0105), and
  // the route's snapshot names it before the game has raised one.
  const roundLoading = !practice && (!worldReady || lobby === null || lobby.phase === "LOADING");
  const loaderLobby = lobby ?? lobbyAtHandover ?? null;
  const loaderTrackId = loaderLobby?.trackId ?? trackId;
  const nameOf = (id: string): string => {
    const listed = trackList?.find((t) => t.id === id);
    return (listed ? (listed.name ?? UNTITLED_TRACK_NAME) : (trackDetail?.name ?? UNTITLED_TRACK_NAME)).toUpperCase();
  };
  // The server numbers a Round from the moment it starts loading; a snapshot
  // from before that (the route's LOBBY handover) still reads the last one.
  const loadingRound =
    loaderLobby === null || loaderLobby.phase === "LOBBY" || loaderLobby.phase === "RESULTS"
      ? (loaderLobby?.round ?? 0) + 1
      : loaderLobby.round;
  // Who the Round is still waiting for, once this client itself is ready.
  const loadingLabel =
    lobby !== null && worldReady
      ? `WAITING FOR PLAYERS ${lobby.loaded.length}/${lobby.players.length}`
      : "LOADING TRACK…";
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
          onRoundHud: (snapshot) => setRoundHud(snapshot),
          // ADR 0089: the game says when its world stands; the server is
          // told over the socket by the game itself.
          onWorldReady: (ready) => setWorldReady(ready),
          onPause: () => setPaused(true),
          // Voice chat places each speaker at their Character (ADR 0111).
          // A per-frame value, so it goes straight to the voice session and
          // never through React (ADR 0060).
          onVoiceScene: placeVoices,
          speakingAccounts,
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
      setRoundHud(null);
      setWorldReady(false);
      setReadyForNextRound(false);
      setShowGo(false);
    };
  }, [trackId, serverPort, connection, practice, graphicsQuality]);

  // Esc toggles the pause sheet in a Round (ADR 0110). While the mouse is
  // held the browser takes Esc for itself and releases it, which the game
  // reports as `onPause`; this is the Esc that arrives with the mouse free.
  const inRound = lobby !== null && lobby.phase !== "LOBBY" && lobby.phase !== "RESULTS" && !practice;
  // On Standings the sheet opens too (ADR 0111), so Voice chat and its Mutes
  // are reachable between Rounds without leaving the Match for `/settings`.
  const onStandings = lobby !== null && lobby.phase === "RESULTS" && !practice;
  const canPause = inRound || onStandings;
  useEffect(() => {
    if (!canPause) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setAllSettings(false);
      setPaused((open) => {
        if (open) handleRef.current?.resume();
        return !open;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canPause]);
  const resume = (): void => {
    setPaused(false);
    setAllSettings(false);
    handleRef.current?.resume();
  };

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
  // Whose avatar is whose (ADR 0110): each Player's Account picture over
  // their bean's Colour, off the roster. Someone no longer on it has left —
  // the disc alone.
  const lookOf = (id: string): AvatarLook => {
    const player = lobby?.players.find((p) => p.id === id);
    return player ? avatarLook(player.accountId, player.color) : NO_AVATAR;
  };
  // Who is talking right now (ADR 0111), as the HUD's own row. The voice room
  // names people by Account and the Lobby roster by session id, so the roster
  // is where the two meet; anyone not on it has left, and is dropped.
  const speakingBeans = lobby === null
    ? []
    : lobby.players
        .filter((p) => p.accountId !== null && voice.isSpeaking(p.accountId))
        .map((p) => ({
          accountId: p.accountId!,
          look: avatarLook(p.accountId, p.color),
          nickname: p.nickname,
          you: p.id === myId,
        }));
  // Voice chat's rows on the pause sheet (ADR 0111) — the scope, and one Mute
  // per Player the link rule joined you to. A Playtest and free roam have no
  // voice, so they get no rows.
  const pauseVoice = usePauseVoice(
    namesFromRoster(lobby?.players ?? []),
    (lobby?.players.length ?? 0) > 1,
  );
  const standingRows = standings ? toStandingRows(standings.standings, myId, lookOf) : null;
  // Who the next Round waits on: everyone still connected, not those who left.
  const stillHere = standings?.standings.filter((row) => !row.gone) ?? [];
  const confirmedCount = stillHere.filter((row) => row.confirmed).length;
  const autoStartAtMs = standings?.autoStartAtMs ?? null;
  const autoStartLabel = autoStartAtMs === null ? null : formatRoundClock(Math.max(0, autoStartAtMs - nowMs));
  const myLobbyPlayer = lobby?.players.find((p) => p.id === myId);
  const isRace = lobby?.roundType === "race";
  // Your place in the start line's order (spawn slots follow join order),
  // among the Players here now — never above the field (ADR 0110).
  const gridSpot = myLobbyPlayer
    ? 1 + (lobby?.players.filter((p) => p.joinOrder < myLobbyPlayer.joinOrder).length ?? 0)
    : 1;
  const lineOrder = myLobbyPlayer
    ? [myLobbyPlayer, ...(lobby?.players.filter((p) => p.id !== myId) ?? [])]
    : (lobby?.players ?? []);
  const nextPick = lobby ? lobby.roundPicks[roundNumber - 1] : undefined;
  const nextTrackName = nextPick?.trackId ? trackNameOf(nextPick.trackId) : "UNREVEALED";
  // The next Track's screenshot (ADR 0085): the same one BetweenRounds names
  // above, and art only when its Revision captured one.
  const nextTrackThumbnail = thumbnailFor(trackList, nextPick?.trackId);
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
      {/* ADR 0089: nothing of the Round shows until this client's world is
          built and the server has everyone else's — the Track's own
          screenshot and name fill the wait (ADR 0085). */}
      {roundLoading && (
        <div className={styles.screenOverlay}>
          {loaderTrackId === undefined ? (
            <LoadingScreen label={loadingLabel} />
          ) : (
            <RoundLoader
              trackName={nameOf(loaderTrackId)}
              thumbnailUrl={thumbnailFor(trackList, loaderTrackId)}
              {...(loaderLobby === null ? {} : { round: loadingRound, rounds: loaderLobby.matchLength })}
              {...(loaderLobby?.roundType ? { mode: loaderLobby.roundType.toUpperCase() } : {})}
              label={loadingLabel}
            />
          )}
        </div>
      )}
      {lobby && (lobby.phase === "COUNTDOWN" || (lobby.phase === "RUNNING" && showGo)) && !practice && trackDetail && (
        <div className={styles.screenOverlay}>
          <Countdown
            round={roundNumber}
            rounds={lobby.matchLength}
            track={(trackDetail.name ?? lobby.trackId).toUpperCase()}
            mode={lobby.roundType.toUpperCase()}
            gridSpot={gridSpot}
            field={lobby.players.length}
            checkpoints={isRace ? totalCheckpoints : 0}
            personalBest={isRace && personalBestMs !== null ? `PB ${formatRaceTime(personalBestMs)}` : null}
            countdownMsLeft={lobby.phase === "COUNTDOWN" ? lobby.countdownMsLeft : 0}
            onTheLine={lineOrder.slice(0, 5).map((p) => lookOf(p.id))}
            othersOnTheLine={Math.max(0, lobby.players.length - 5)}
          />
        </div>
      )}
      {/* ADR 0088: the Round HUD, over the live Round while you are still in it —
          under the verdict, the Hit flash and the Spectator panel (DOM order is
          z order), and held back for the GO! beat. Pointer-transparent: a click
          still reaches the canvas for pointer lock. */}
      {lobby && lobby.phase === "RUNNING" && roundHud && !showGo && runEnd === null && spectate === null && !practice && (
        <div className={`${styles.screenOverlay} ${styles.hudOverlay}`}>
          {roundHud.kind === "race" ? (
            <RaceHUD
              position={roundHud.place}
              field={roundHud.field}
              time={formatRaceClock(roundHud.elapsedMs).time}
              ms={formatRaceClock(roundHud.elapsedMs).tenths}
              delta={roundHud.splitMs === null ? null : formatSplit(roundHud.splitMs)}
              deltaAhead={roundHud.splitMs !== null && roundHud.splitMs < 0}
              checkpoint={roundHud.checkpointsReached}
              checkpoints={roundHud.checkpoints}
              personalBest={personalBestMs === null ? null : `PB ${formatRaceTime(personalBestMs)}`}
              threat={
                roundHud.threat === null
                  ? null
                  : { name: roundHud.threat.nickname.toUpperCase(), look: lookOf(roundHud.threat.id) }
              }
              dashCharge={roundHud.dashCharge}
              dashReady={roundHud.dashReady}
              dashRechargeS={roundHud.dashRechargeS}
              dashKey={roundHud.dashKey}
            />
          ) : (
            <SurvivalHud
              remaining={roundHud.remaining}
              startedWith={roundHud.startedWith}
              alive={roundHud.alive.map(lookOf)}
              youAlive={roundHud.youAlive}
              survived={formatSurvived(roundHud.survivedMs)}
              lastOut={
                roundHud.lastOut === null
                  ? null
                  : `${roundHud.lastOut.toUpperCase()} ${roundHud.lastOutLeft ? "LEFT" : "WAS ELIMINATED"}`
              }
              critical={roundHud.critical}
              dashCharge={roundHud.dashCharge}
              dashReady={roundHud.dashReady}
              dashRechargeS={roundHud.dashRechargeS}
              dashKey={roundHud.dashKey}
            />
          )}
          {/* Who is talking (ADR 0111) — always on, and inside the Round HUD's
              own overlay so it sits under the verdict and the Spectator panel
              exactly as the rest of the HUD does. */}
          <div className={styles.speakingRow}>
            <SpeakingRow speaking={speakingBeans} />
          </div>
        </div>
      )}
      {/* ADR 0104: a hold, either end — its own overlay above the Round HUD, so
          the held Player's column sits over everything else it could read, and
          the grabber's panel over the HUD's bottom edge. Same conditions as the
          HUD it belongs to. */}
      {lobby && lobby.phase === "RUNNING" && roundHud?.hold && !showGo && runEnd === null && spectate === null && !practice && (
        <div className={`${styles.screenOverlay} ${styles.hudOverlay}`}>
          {roundHud.hold.role === "held" ? (
            <Grabbed
              by={roundHud.hold.by.toUpperCase()}
              phase={roundHud.hold.phase}
              progress={Math.round(roundHud.hold.escape * 100)}
              wiggleKeys={roundHud.hold.wiggleKeys}
            />
          ) : (
            <HoldingPanel
              holding={roundHud.hold.holding.toUpperCase()}
              phase={roundHud.hold.phase}
              escape={Math.round(roundHud.hold.escape * 100)}
              timeLeft={`${(roundHud.hold.timeLeftMs / 1000).toFixed(1)}s`}
              windup={roundHud.hold.windup}
              overspin={roundHud.hold.overspin}
              spinKey={roundHud.hold.spinKey}
              letGoKey={roundHud.hold.letGoKey}
            />
          )}
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
                        // The design's third plate, off the Personal Best this
                        // Round started with (ADR 0088, 0110) — only when one exists.
                        ...(personalBestMs === null || runEnd.raceTimeMs === null
                          ? []
                          : [offYourPb(runEnd.raceTimeMs - personalBestMs)]),
                      ]
                    : [
                        { label: "SURVIVED", value: formatSurvived(runEnd.survivedMs ?? 0) },
                        { label: "POINTS", value: `+${Math.round(runEnd.points)}`, accent: true as const },
                        // ADR 0110: who put you out, when someone did.
                        ...(runEnd.outBy === null
                          ? []
                          : [
                              {
                                label: `${runEnd.outBy.how.toUpperCase()} BY`,
                                value: runEnd.outBy.nickname.toUpperCase(),
                              },
                            ]),
                      ],
              },
            ]}
            position={runEnd.placement}
            field={runEnd.playerCount}
            checkpoints={isRace ? totalCheckpoints : 0}
            checkpointsDone={runEnd.outcome === "finished" ? totalCheckpoints : (runEnd.checkpointIndex ?? -1) + 1}
            personalBest={isRace && personalBestMs !== null ? `PB ${formatRaceTime(personalBestMs)}` : null}
            roundEndsIn={formatRoundClock(lobby.timeLimitMs)}
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
            followingLook={lookOf(spectate.followingId ?? myId ?? "")}
            place={spectate.followedPlace === null ? "—" : `#${spectate.followedPlace}`}
            aliveFor={formatSurvived(spectate.aliveForMs)}
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
                const board = betting?.runners.find((entry) => entry.playerId === runner.id);
                return {
                  id: runner.id,
                  name: runner.nickname,
                  look: lookOf(runner.id),
                  odds: board?.odds ?? null,
                  ...(board === undefined ? {} : { pool: board.pool }),
                };
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
                look: avatarLook(latest.accountId, null),
              };
            })()}
            // ADR 0110: a board closes when one runner is left, not on a clock.
            closesIn={betting && betting.open ? "AT 1 LEFT" : null}
            balance={beanBalance}
            {...(betting === null ? {} : { totalPool: betting.totalPool })}
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
          <div className={styles.screenOverlay}>
            <RoundLoader
              trackName={nextTrackName.toUpperCase()}
              thumbnailUrl={nextTrackThumbnail}
              round={roundNumber + 1}
              rounds={lobby.matchLength}
              {...(nextPick?.roundType ? { mode: nextPick.roundType.toUpperCase() } : {})}
              label={`WAITING FOR PLAYERS ${confirmedCount}/${stillHere.length}`}
            />
          </div>
        ) : standings.roundsRemaining && scoreboardOpen ? (
          <div className={styles.screenOverlay}>
            <Scoreboard rows={standingRows ?? []} title={`AFTER ROUND ${roundNumber}`} onBack={() => setScoreboardOpen(false)} />
          </div>
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
              {...(nextTrackThumbnail === undefined ? {} : { nextThumbnail: nextTrackThumbnail })}
              {...(autoStartLabel === null ? {} : { autoStart: autoStartLabel })}
              readyCount={confirmedCount}
              readyOf={stillHere.length}
              onReady={() => {
                setReadyForNextRound(true);
                handleRef.current?.standingsReady();
              }}
              onScoreboard={() => setScoreboardOpen(true)}
              onLeave={goToMainMenu}
            />
          </div>
        ) : (
          // Terminal RESULTS (ADR 0059): the server is saving (or just
          // saved) — the effect above navigates to the results page the
          // moment `matchOver` lands, unmounting this canvas behind it.
          <LoadingScreen label="SAVING RESULTS…" />
        ))}
      {paused && canPause && (
        <div className={styles.screenOverlay}>
          {allSettings ? (
            <Settings onClose={() => setAllSettings(false)} />
          ) : (
            <PauseMenu
              settings={gameplay}
              onChange={setGameplay}
              onClose={resume}
              onAllSettings={() => setAllSettings(true)}
              // Standings has its own way on (LEAVE, PLAY AGAIN); quitting the
              // Match from a Round is the only place that button belongs.
              {...(inRound ? { onQuit: goToMainMenu } : {})}
              {...(practice ? {} : { voice: pauseVoice })}
            />
          )}
        </div>
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
