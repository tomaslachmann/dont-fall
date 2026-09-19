import type { MatchWinner, ResultsRow, RoundType } from "@dont-fall/shared";
import type { GraphicsQuality } from "../lib/graphicsQuality.js";
import type { LobbyConnection, LobbySnapshot } from "../lib/socket/lobbyConnection.js";
import type { HitTakenEvent } from "./hitTaken.js";
import type { PracticeSnapshot } from "./practice.js";
import type { RoundHudSnapshot } from "./roundHud.js";
import type { RunEndEvent } from "./runEnd.js";
import type { SpectateSnapshot } from "./spectator.js";

/**
 * The game module's boundary with the shell (ADR 0008), and nothing else: what
 * the shell says to start a game, what it hears back, and what it can ask for
 * while one runs. Kept in its own file so both sides of the dynamic import can
 * name these without pulling the renderer in behind them.
 */

/** Why the game stopped being playable and handed control back to the shell. */
export type ExitReason = "disconnected";

/**
 * One Player's running Match total, ready to render (M7 ticket 06, ADR
 * 0049) — computed here from the replicated `roundResults`, never sent:
 * "Score is derived, never sent" (protocol.ts's own `roundResults` doc).
 * `placement` is a tie-aware rank over `score` (`rankWithTies`), never a
 * bare array index — two equal totals share a placement.
 *
 * `gone` is ticket 08's own data contract: true for an id that appears in
 * some `RoundResult`'s rows (so it has Score to show) but is no longer in
 * `lobby.players` (so it isn't here to see it) — a Player who dropped
 * mid-Match, parked rather than erased.
 *
 * `confirmed` (M7 ticket 10/12, ADR 0051) — whether this Player has clicked
 * Ready for the next Round yet, read straight off the replicated
 * `standingsReady` list. Meaningless (always `false`) once the Match has
 * ended — there is no confirmation to gate at that point.
 */
export interface StandingsRow {
  id: string;
  nickname: string;
  score: number;
  placement: number;
  gone: boolean;
  confirmed: boolean;
  /**
   * This Round's Score: the total now less the total before the Round that
   * just ended, both off `roundResults` (ADR 0110). `0` for anyone who sat it out.
   */
  gained: number;
  /** Where this Player stood before the Round that just ended, or `null` if they had no Score then. */
  previousPlacement: number | null;
}

/**
 * Everything a Standings Screen renders for one snapshot (M7 ticket 06) —
 * the Round just played (`results`, identical to what a plain Results
 * Screen showed pre-M7) alongside the Match's running `standings`.
 * `winners` is empty while `roundsRemaining`, and only ever populated
 * (length 1, or more on a genuine tie) once the Match has actually ended.
 */
export interface StandingsSnapshot {
  results: ResultsRow[];
  roundsRemaining: boolean;
  standings: StandingsRow[];
  winners: MatchWinner[];
  /**
   * When these Standings move on without everyone's Ready, on this page's
   * `Date.now()` clock: the server's deadline through time sync (ADR 0110).
   * `null` when there is none, or before the clock has synced.
   */
  autoStartAtMs: number | null;
}

/**
 * Everything the shell tells the game, and everything the game tells the shell
 * back — the "small typed boundary (config in, `onMatchEnd`/`onExit` out)" ADR
 * 0008 requires. Nothing is shared mutable state: the fixed-timestep loop
 * never runs through React, and React never reaches into the loop.
 */
export interface GameConfig {
  /** Element the canvas and HUD are mounted into. The game empties it again on `stop`. */
  mount: HTMLElement;
  /** Host serving the Match server and the API. Defaults to the host serving the page. */
  host?: string;
  /** A specific Track to play — Track Builder's Playtest (ADR 0028). Omitted: whatever the server chose. */
  trackId?: string;
  /**
   * The port of the Lobby the lobby broker sent this Player to (ADR 0054).
   * Every brokered Lobby binds an ephemeral port, so the shell must name
   * one; omitted, this falls back to the fixed-port standalone Match server
   * `scripts/dev.sh` still starts for a single-Lobby test.
   */
  serverPort?: number;
  /**
   * A live shell-owned connection to boot on top of (ADR 0056) — the same
   * socket the Lobby Screen already used, so Player identity (`welcome`)
   * survives the LOBBY → COUNTDOWN handoff instead of rejoining as a
   * stranger on a second socket. When present, `serverPort`/`trackId` are
   * ignored (the socket is already open) and the game never closes it —
   * the shell still owns that lifetime.
   */
  connection?: LobbyConnection;
  /**
   * Free-roam practice instead of a Match (m8.1): the Track simulated
   * locally, no socket, no Lobby, no Rounds. Requires `trackId` — with no
   * server there is nothing to default to.
   */
  practice?: boolean;
  /**
   * Raised once at practice boot (so the hint bar has a Track name
   * immediately) and again on the finish crossing (m8.1 ticket 03) — the
   * whole React surface of a practice session. Never raised in a Match;
   * `onLobbyState`/`onStandings` are never raised in practice.
   */
  onPracticeState?: (snapshot: PracticeSnapshot) => void;
  /** The graphics quality level to draw at (ADR 0079). Omitted, `high`. */
  graphicsQuality?: GraphicsQuality;
  /**
   * Declared because ADR 0008 names it as half of the game's boundary
   * ("config in, `onMatchEnd`/`onExit` out"), but nothing raises it: Results
   * (M4 ticket 08) turned out to be an overlay on this same, still-running
   * `<GameCanvas>` — read `onStandings`/`phase` below — rather than a reason to
   * leave the Match the way `onExit` does. Reserved for an actual "leave the
   * Match entirely" action, which nothing in the game yet offers.
   */
  onMatchEnd?: () => void;
  /**
   * Raised when the game can no longer continue — today only a lost
   * connection, which M2 does not reconnect from (ADR 0011).
   *
   * The game reports; it never tears itself down. Whether a disconnect routes
   * back to the menu, offers a reload, or is ignored is the shell's decision,
   * and the shell is what calls {@link GameHandle.stop}.
   */
  onExit?: (reason: ExitReason) => void;
  /**
   * Raised on every snapshot whose Lobby content actually changed (M4 ticket
   * 07) — a Lobby Screen renders this as an overlay on top of the already-
   * connected, already-rendering `<GameCanvas>` while `phase === "LOBBY"`,
   * the same way the Countdown overlay reads `phase`/`countdownMsLeft`
   * (ADR 0040). Never fired for a no-op update (nickname/ready/host all
   * unchanged): the snapshot arrives at up to `snapshotHz`, far too often to
   * hand React a fresh object every time regardless of whether anything in
   * it actually moved.
   */
  onLobbyState?: (lobby: LobbySnapshot) => void;
  /**
   * Raised on every snapshot whose Standings content actually changed (M4
   * ticket 08, M7 ticket 06), while `phase` is RESULTS — a Standings Screen
   * renders this the same way a Lobby Screen renders `onLobbyState`: an
   * overlay on top of the already-rendering `<GameCanvas>`, not a route the
   * shell navigates to. Deduped the same way, against the same
   * snapshot-rate firehose.
   */
  onStandings?: (snapshot: StandingsSnapshot) => void;
  /**
   * Raised once per Round when your own run ends mid-Round (ticket 14) — a
   * race finish or a Survival elimination. The FinishedOrOut verdict's
   * facts, off the authoritative snapshot: placement among the field as the
   * server sees it, never the local prediction's guess.
   */
  onRunEnd?: (event: RunEndEvent) => void;
  /**
   * Raised every time your own Character takes a Hit mid-Round (M9 ticket
   * 09, Hit-received) — off your `hitReactEpoch` rising on the authoritative
   * snapshot, never the local prediction. The HitFeedback flash's facts:
   * whether this landing knocked you down with it.
   */
  onHitTaken?: (event: HitTakenEvent) => void;
  /**
   * Raised whenever Spectator Mode's facts change (ticket 14) — who the
   * camera follows, who is still racing, whether FREE CAM holds the pose —
   * and once with `null` when spectating stops. The Spectator panel's feed,
   * deduped against the frame rate like `onLobbyState`.
   */
  onSpectate?: (snapshot: SpectateSnapshot | null) => void;
  /**
   * Raised whenever the Round HUD's facts change (ADR 0088) — the Race or
   * Survival readout, off the authoritative snapshot, every value rounded to
   * what is drawn — and with `null` once there is no Round HUD to show. Deduped
   * against the snapshot rate like `onSpectate`, so React re-renders only
   * when something visible moved.
   */
  onRoundHud?: (snapshot: RoundHudSnapshot | null) => void;
  /**
   * Raised with `false` while this client is building (or rebuilding) the
   * world, and `true` the moment it stands ready (ADR 0089) — what the shell
   * shows its loading Screen from. The server is told the same thing over the
   * socket; this is only the local half, so the Screen never has to guess
   * from a phase whether *this* client is the one still loading.
   */
  onWorldReady?: (ready: boolean) => void;
  /**
   * The Player let go of the mouse mid-Match — Esc, or the window lost focus
   * (ADR 0110). The shell shows the pause sheet; the Round runs on underneath,
   * and {@link GameHandle.resume} takes the mouse back.
   */
  onPause?: () => void;
}

export interface GameHandle {
  /**
   * Tear the game down: the loop, the socket, the Rapier world, the WebGL
   * context, the HUD and every listener. Idempotent, and complete enough that
   * starting again in the same page session leaves nothing behind (M4 ticket 01).
   */
  stop: () => void;
  /** Sets this connection's own Ready state (M4 ticket 07). Only meaningful in LOBBY. */
  setReady: (ready: boolean) => void;
  /** Host-only: picks a different Track for this Lobby (M4 ticket 07). Ignored if not host or not in LOBBY. */
  selectTrack: (trackId: string) => void;
  /** Host-only: picks this Lobby's Round type (M5 ticket 07). Ignored if not host or not in LOBBY. */
  setRoundType: (roundType: RoundType) => void;
  /** Host-only: sets this Match's length (M7 ticket 05, ADR 0049). Ignored if not host, not in LOBBY, or out of bounds. */
  setMatchLength: (matchLength: number) => void;
  /**
   * Host-only: picks (or clears) a Track/Round type for a Round after the
   * one about to start (M7 ticket 05) — `roundIndex` is 0-based and counts
   * from Round 1, so `1` is Round 2's slot. `null` for either field leaves
   * it to the server's draw. Ignored if not host, not in LOBBY, or the
   * index doesn't name a Round this Match will actually play.
   */
  pickRoundSlot: (roundIndex: number, trackId: string | null, roundType: RoundType | null) => void;
  /** Host-only: asks the server to start the Round (M4 ticket 07). Ignored unless the server's own gate passes. */
  start: () => void;
  /**
   * Confirms this Player's own Ready for the next Round, from the
   * Standings Screen (M7 ticket 10, ADR 0051) — not host-only, unlike
   * every other action here. Ignored outside RESULTS. Retired
   * `returnToLobby` (M4 ticket 08): there is no group action left to send
   * at Match end, only this Round's own confirmation between Rounds.
   */
  standingsReady: () => void;
  /**
   * Follows one bean exactly (ticket 14) — the Spectator panel's bean
   * buttons. Ignored for anyone not still racing, and outside Spectator
   * Mode entirely: with nobody to follow there is nothing to aim at.
   */
  spectateFollow: (playerId: string) => void;
  /** Steps to the next living bean — the shell NEXT pill's half of the cycle key. */
  spectateNext: () => void;
  /** Steps back — the shell PREV pill's half. */
  spectatePrev: () => void;
  /**
   * Holds (or releases) the camera's pose (ticket 14) — FREE CAM looks
   * around from where the follow was released instead of tracking. Any
   * follow resumes tracking and reports back through `onSpectate`.
   */
  setFreeCam: (on: boolean) => void;
  /**
   * Asks to spectate as a finisher (ticket 14) — the verdict's SPECTATE on
   * a finished run. Elimination spectates unasked; a finisher opts in, and
   * only a finisher: anything else (or anything outside RUNNING) ignores
   * it. Lasts until the Round ends.
   */
  enterSpectate: () => void;
  /** Takes the mouse back after the pause sheet closes (ADR 0110) — call it from the click that closed it. */
  resume: () => void;
}
