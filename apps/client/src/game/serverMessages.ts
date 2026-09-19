import {
  TICK_MS,
  buildResults,
  leadReceiveQueueDepth,
  matchWinner,
  type ServerMessage,
  type SnapshotMessage,
} from "@dont-fall/shared";
import { setMusicPhase } from "../audio/music.js";
import { toLobbySnapshot, type LobbySnapshot } from "../lib/socket/lobbyConnection.js";
import { heldSinceTickAfter } from "./frameLoop.js";
import { detectHitTaken } from "./hitTaken.js";
import { buildRoundHud } from "./roundHud.js";
import { needsTrackReload } from "./roundTrack.js";
import { detectRunEnd } from "./runEnd.js";
import { sendLoaded, swapTrack, type GameSession } from "./session.js";
import { localDeadline, standingsRows } from "./standings.js";
import type { StandingsSnapshot } from "./types.js";

/**
 * What the server says, applied.
 *
 * `awaitWelcome` has already consumed the one-time `welcome` — a Match server
 * sends exactly one per connection (ADR 0024) — so this only ever sees `pong`
 * and `snapshot`. One snapshot is read by seven readers in a fixed order, each
 * a function below: the Round's clock, the roster, your own run, the three
 * shell feeds, the loading gate, and finally the Track itself.
 */

/**
 * The Round's own phase, clock and rules. `session.match.phase` still holds the
 * *previous* phase while this runs, which is what makes RUNNING entry an edge
 * rather than a level.
 */
/** How far into the Round this snapshot's Tick is, on the server's clock: the Time Limit less the time left. */
const roundElapsedMs = (message: SnapshotMessage): number =>
  Math.max(0, message.roundRules.timeLimitMs - message.timeLeftMs);

const applyRoundClock = (session: GameSession, message: SnapshotMessage): void => {
  const { match, run } = session;
  match.timeLeftMs = message.timeLeftMs;
  match.roundElapsedMs = message.phase === "RUNNING" ? roundElapsedMs(message) : null;
  match.livePlaces = message.liveRace?.places ?? null;
  // Ticket 14: RUNNING entry re-arms the once-per-Round verdict.
  if (message.phase === "RUNNING" && match.phase !== "RUNNING") {
    run.verdictFired = false;
    run.wasFinished = false;
    run.wasEliminated = false;
    run.lastHitEpochs = null;
  }
  // A game that dialled its own socket (a `?track=` playtest) has no Lobby
  // route to tell the music its phase (M14 ticket 11), so it tells it itself;
  // on teardown the app's own music, the Lobby's playlist, comes back.
  if (!session.borrowedSocket && message.phase !== match.musicPhase) {
    match.musicPhase = message.phase;
    setMusicPhase(message.phase);
  }
  match.phase = message.phase;
  match.countdownEndsAtServerMs =
    message.phase === "COUNTDOWN" ? message.serverTimeMs + message.countdownMsLeft : null;
  if (message.phase === "RESULTS") {
    const winners = message.roundsRemaining ? [] : matchWinner(message.roundResults);
    match.resultsCall = {
      matchOver: !message.roundsRemaining,
      won: winners.some((winner) => winner.id === session.myId),
      soleWinner: winners.length === 1,
      finalRoundNext: message.roundsRemaining && message.roundResults.length === message.lobby.matchLength - 1,
    };
  } else {
    match.resultsCall = null;
  }
  match.survival = message.roundRules.fallBehavior === "eliminate";
  // The server's own resolved RoundRules (M5 ticket 02, ADR 0041) — adopted
  // every snapshot, same cadence as the phase, so this client's prediction
  // runs against the identical record rather than its own construction-time
  // guess at the Track's bare default, which a Match-level override can
  // disagree with.
  session.world.localSim.syncRoundRules(message.roundRules);
};

const applyRoster = (session: GameSession, message: SnapshotMessage): void => {
  const { roster } = session;
  const players = message.lobby.players;
  roster.names = Object.fromEntries(players.map((player) => [player.id, player.nickname]));
  roster.colors = Object.fromEntries(players.map((player) => [player.id, player.color]));
  roster.skins = Object.fromEntries(players.map((player) => [player.id, player.skin]));
  roster.hats = Object.fromEntries(players.map((player) => [player.id, player.hat]));
  for (const player of players) roster.known.set(player.id, player.nickname);
  for (const dropped of message.dnf) roster.known.set(dropped.id, dropped.nickname);
};

/**
 * Your own run's two shell events (ticket 14, M9 ticket 09), both off this
 * exact snapshot. Outside RUNNING the edges re-sync silently instead, so a
 * late snapshot cannot verdict a Round already over — and RUNNING entry above
 * re-arms everything anyway.
 */
const applyOwnRun = (session: GameSession, message: SnapshotMessage): void => {
  const { run, callbacks, myId } = session;
  if (message.phase !== "RUNNING") {
    run.wasFinished = false;
    run.wasEliminated = false;
    run.verdictFired = false;
    run.lastHitEpochs = null;
    session.spectate.requested = false;
    return;
  }
  const myChar = message.state.characters[myId];
  if (callbacks.onRunEnd && !run.verdictFired && myChar !== undefined) {
    // Off the server's Ticks, not arrival (ADR 0110): the finish is the
    // Tick it happened on, however many snapshots later this one is — the
    // same count Personal Bests are stored from.
    const elapsed = roundElapsedMs(message);
    const raceTimeMs =
      myChar.finishTick === null ? elapsed : Math.max(0, elapsed - (message.state.tick - myChar.finishTick) * TICK_MS);
    const event = detectRunEnd({
      wasFinished: run.wasFinished,
      wasEliminated: run.wasEliminated,
      character: myChar,
      characters: message.state.characters,
      myId,
      raceTimeMs,
      survivedMs: elapsed,
      nicknameOf: (id) => session.roster.known.get(id) ?? "Player",
    });
    if (event) {
      run.verdictFired = true;
      callbacks.onRunEnd(event);
    }
  }
  run.wasFinished = myChar !== undefined && myChar.finishTick !== null;
  run.wasEliminated = myChar?.eliminated ?? false;
  // The Hit flash fires off every `hitReactEpoch` edge — unlike the verdict, a
  // Round can flash many times. The baseline re-syncs every snapshot, so a
  // reordered snapshot never re-fires what already played.
  if (callbacks.onHitTaken && myChar !== undefined) {
    const hitEvent = detectHitTaken({ previous: run.lastHitEpochs, character: myChar });
    if (hitEvent) callbacks.onHitTaken(hitEvent);
  }
  run.lastHitEpochs =
    myChar === undefined ? run.lastHitEpochs : { hitReactEpoch: myChar.hitReactEpoch, ragdollEpoch: myChar.ragdollEpoch };
};

/** The Round HUD (ADR 0088): built off every snapshot, raised only when a drawn value changed. */
const raiseRoundHud = (session: GameSession, message: SnapshotMessage): void => {
  const onRoundHud = session.callbacks.onRoundHud;
  if (!onRoundHud) return;
  const roundHud = buildRoundHud({
    myId: session.myId,
    phase: message.phase,
    roundRules: message.roundRules,
    timeLeftMs: message.timeLeftMs,
    characters: message.state.characters,
    liveRace: message.liveRace,
    checkpoints: session.world.checkpointCount,
    nicknameOf: (id) => session.roster.known.get(id) ?? id,
    leftIds: message.dnf.map((entry) => entry.id),
    tick: message.state.tick,
    // ADR 0104: a hold's meter and wind-up move on the press, not a round trip later.
    predicted: session.world.localSim.snapshot().characters[session.myId] ?? { escapeProgress: 0, spinMs: 0 },
    bindings: session.keyboard.currentBindings,
  });
  session.gates.roundHud.raise(roundHud, onRoundHud);
};

const raiseLobby = (session: GameSession, message: SnapshotMessage): void => {
  const onLobbyState = session.callbacks.onLobbyState;
  if (!onLobbyState) return;
  // One projection, shared with the shell's own connection (ADR 0056) — the
  // game never maintains a second mapping of the same snapshot, so the two can
  // never disagree about the Lobby.
  const lobby: LobbySnapshot = toLobbySnapshot(session.myId, session.welcome.config.maxPlayers, message);
  session.gates.lobby.raise(lobby, onLobbyState);
};

const raiseStandings = (session: GameSession, message: SnapshotMessage): void => {
  const onStandings = session.callbacks.onStandings;
  if (!onStandings || message.phase !== "RESULTS") return;
  const results = buildResults(message.state.characters, message.lobby.players, message.dnf);
  // M7 ticket 10, ADR 0051: the server's own `canContinueMatch()` — Rounds
  // remain *and* enough Players are still connected to run one — read straight
  // off the snapshot, never re-derived from `roundResults.length < matchLength`
  // alone (code review): that ignores the population half of the gate, and
  // used to show a "Ready for next Round" button the server would never honour.
  const roundsRemaining = message.roundsRemaining;
  const { timeSync } = session.net;
  const snapshot: StandingsSnapshot = {
    results,
    roundsRemaining,
    standings: standingsRows(message, (id) => session.roster.known.get(id) ?? id),
    winners: roundsRemaining ? [] : matchWinner(message.roundResults),
    autoStartAtMs: localDeadline(
      message.standingsDeadlineMs,
      timeSync.ready ? performance.now() + timeSync.serverClockOffsetMs : null,
      Date.now(),
    ),
  };
  session.gates.standings.raise(snapshot, onStandings);
};

/**
 * ADR 0089: the server is holding this Round until every client has its world.
 * Answered off the snapshot itself — level-triggered, not once at boot: every
 * Round clears the list server-side, and a Round that replays the Track this
 * client already has loads nothing and so would never report again.
 * Self-limiting: the moment the server has this client in `loaded`, the
 * condition stops holding.
 */
const answerLoadingGate = (session: GameSession, message: SnapshotMessage): void => {
  if (
    message.phase === "LOADING" &&
    !session.world.reloadInFlight &&
    !message.loaded.includes(session.myId) &&
    message.trackId === session.world.trackId &&
    message.trackRevision === session.world.trackRevision
  ) {
    sendLoaded(session, { trackId: message.trackId, trackRevision: message.trackRevision });
  }
};

/**
 * The server is on a different Track than this client has loaded — the Lobby
 * host's pick (M4 ticket 07), or the Track this Match drew for its next Round
 * (M7 ticket 04, inside COUNTDOWN). Either way the server has already re-seated
 * every connected Character onto it (this snapshot's `state` reflects that), so
 * the local simulation must follow before anything else trusts it.
 *
 * Deliberately not gated on LOBBY: that left every later Round drawing the
 * previous Round's Track, with Characters standing inside scenery that was not
 * where the server had them.
 */
const followTrack = (session: GameSession, message: SnapshotMessage): void => {
  const world = session.world;
  if (
    !needsTrackReload(
      { trackId: world.trackId, trackRevision: world.trackRevision },
      { trackId: message.trackId, trackRevision: message.trackRevision },
      world.reloadInFlight,
    )
  ) {
    return;
  }
  world.reloadInFlight = true;
  // Building again: the Screen goes back to loading, and this client is no
  // longer ready for anything (ADR 0089).
  session.callbacks.onWorldReady?.(false);
  // The server already placed this Character at its spawn slot on the new
  // Track (`trackSpawn`, mirrored by `buildSimulationFor`) — read straight off
  // this very snapshot rather than recomputed, so there is exactly one source
  // for "where do I start".
  const spawn = message.state.characters[session.myId]?.position ?? session.welcome.spawn;
  swapTrack(session, { trackId: message.trackId, trackRevision: message.trackRevision }, spawn)
    .catch((err: unknown) => console.error("DON'T FALL: failed to load the Lobby's newly picked Track", err))
    .finally(() => {
      session.world.reloadInFlight = false;
    });
};

/**
 * Tick-aligned replay against the authority (ADR 0013). `reconcile` pins Props
 * to the snapshot itself before replaying, so replayed ticks slide against
 * Props where the server has them (ADR 0016 — Props are never predicted); the
 * live prediction's Props and mirrors are re-pinned every frame from the
 * *interpolated* render pose instead, so a Prop you are pushing advances
 * smoothly rather than sawtoothing once per snapshot.
 */
const reconcile = (session: GameSession, message: SnapshotMessage): void => {
  const character = message.state.characters[session.myId];
  if (!character || session.world.reloadInFlight) return;
  // ADR 0104: a hold is only ever resolved on the server, so the prediction
  // hears about it here — before the replay below, which has to walk (or
  // Struggle) the way the server now says this Character is.
  session.world.localSim.syncOwnHold(session.myId, character);
  session.world.predictionLoop.reconcile(
    character,
    message.state.tick,
    message.state.props,
    session.net.propPrediction,
    message.phase,
  );
};

export const handleServerMessage = (session: GameSession, message: ServerMessage, receivedAtMs: number): void => {
  if (message.type === "pong") {
    session.net.timeSync.receivePong(message, receivedAtMs);
    return;
  }
  if (message.type !== "snapshot") return;

  // ADR 0109: the Tick a hold taken on the feet began on, off the edge between
  // this Snapshot and the one before — every Snapshot, not every frame, so a
  // frame that brings two cannot move it a Tick late.
  const myId = session.myId;
  session.net.heldSinceTick = heldSinceTickAfter(
    session.net.heldSinceTick,
    session.net.latestSnapshot?.characters[myId]?.motionState,
    message.state.characters[myId]?.motionState,
    message.state.tick,
  );
  session.net.latestSnapshot = message.state;
  session.net.serverInterp.receive(message.state, receivedAtMs, message.serverTimeMs);
  applyRoundClock(session, message);
  applyRoster(session, message);
  applyOwnRun(session, message);
  raiseRoundHud(session, message);
  raiseLobby(session, message);
  raiseStandings(session, message);
  answerLoadingGate(session, message);
  leadReceiveQueueDepth(session.net.lead, message.commandQueueDepth);
  followTrack(session, message);
  reconcile(session, message);
};
