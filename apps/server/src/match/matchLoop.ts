import {
  MATCH_OVER_CLOSE_GRACE_MS,
  SNAPSHOT_HZ,
  TICK_MS,
  TICK_RATE_HZ,
  advanceMatchPhase,
  allQualified,
  buildResults,
  buildRoundResult,
  checkpointSplits,
  countdownMsLeft,
  liveRacePlaces,
  msToTicks,
  recordCheckpointArrivals,
  resolveHostId,
  roundTimeLeftMs,
  survivorTargetReached,
  type LiveRace,
  type PersistedMatchResult,
  type ServerMessage,
  type SimInputs,
  type SimState,
} from "@dont-fall/shared";
import { trySend } from "../net/wire.js";
import { openBettingArgs, roundWinners, runnersLeft } from "./betting.js";
import { survivalTimesMs } from "./career.js";
import type { MatchRuntime } from "./matchRuntime.js";
import type { TickPerf } from "./tickPerf.js";
import { startTickScheduler, type TickScheduler } from "./tickScheduler.js";

/**
 * The idle-phase broadcast decision (ADR 0057) — pure, so tests can pin the
 * table without a socket: send when a join (or a `sync`) set the dirty flag,
 * when this is the first broadcast yet, or when the shared payload changed;
 * otherwise stay silent. Level-triggered by construction — the caller
 * compares the *current* payload every tick, so there is no "event" to miss.
 */
export const shouldBroadcastIdle = (
  snapshotDirty: boolean,
  sharedJson: string,
  lastBroadcastJson: string | null,
): boolean => snapshotDirty || sharedJson !== lastBroadcastJson;

/** Ticks between results-save retries — a down API gets one attempt per window, never 30 hammering ones per second. */
export const SAVE_RETRY_TICKS = 2 * TICK_RATE_HZ;

/** The smallest `MatchRuntime` surface the results save needs — the loop passes the real runtime, tests a fake. */
export interface SaveRuntime {
  savingResults: boolean;
  lastSaveAttemptTick: number | null;
  resultsSavedMatchId: string | null;
  resultsSavedAtMs: number | null;
  closed: boolean;
  config: { matchId: string };
  roundResults: MatchRuntime["roundResults"];
  roundTrackIds: string[];
  matchNicknames: Map<string, string>;
  matchAccountIds: Map<string, string>;
  matchColors: Map<string, number>;
  matchSkins: Map<string, string>;
  matchHats: Map<string, string>;
  totalFalls: Record<string, number>;
  matchSurvivalMs: Map<string, number>;
  matchGrabsBroken: Map<string, number>;
  matchResults: MatchRuntime["matchResults"];
}

/**
 * Kicks off the terminal results save unless one is already in flight or the
 * last attempt is still inside its retry window (ADR 0059). Fire-and-observe:
 * success lands `resultsSavedMatchId` (which is what the snapshot's
 * `matchOver` reads), failure just frees the in-flight flag so a later tick
 * retries. Never throws — the notifier reports, it doesn't raise.
 */
export const saveMatchResultIfDue = (rt: SaveRuntime, thisTick: number): void => {
  if (rt.savingResults) return;
  // A Match with not one played Round has nothing to persist — and a
  // `results: []` the API would rightly refuse (found live 2026-09-18 as an
  // endless 400 retry that also kept the server open, since the terminal
  // close waits for a successful save). Mark it saved so `matchOver` raises
  // and the close proceeds; the results page's fetch 404s, which is the
  // truth: no results exist.
  if (rt.roundResults.length === 0) {
    rt.resultsSavedMatchId = rt.config.matchId;
    rt.resultsSavedAtMs = Date.now();
    return;
  }
  if (rt.lastSaveAttemptTick !== null && thisTick - rt.lastSaveAttemptTick < SAVE_RETRY_TICKS) return;
  rt.savingResults = true;
  rt.lastSaveAttemptTick = thisTick;
  const result: PersistedMatchResult = {
    matchId: rt.config.matchId,
    results: [...rt.roundResults],
    roundTrackIds: [...rt.roundTrackIds],
    nicknames: Object.fromEntries(rt.matchNicknames),
    accountIds: Object.fromEntries(rt.matchAccountIds),
    colors: Object.fromEntries(rt.matchColors),
    skins: Object.fromEntries(rt.matchSkins),
    hats: Object.fromEntries(rt.matchHats),
    totalFalls: { ...rt.totalFalls },
    survivalMs: Object.fromEntries(rt.matchSurvivalMs),
    grabsBroken: Object.fromEntries(rt.matchGrabsBroken),
    endedAtMs: Date.now(),
  };
  void rt.matchResults.saveResult(result).then((saved) => {
    rt.savingResults = false;
    if (rt.closed) return;
    if (saved) {
      rt.resultsSavedMatchId = result.matchId;
      rt.resultsSavedAtMs = Date.now();
    }
  });
};

/** The smallest `MatchRuntime` surface the terminal self-close needs — same fake-runtime seam as above. */
export interface CloseRuntime {
  closeRequested: boolean;
  resultsSavedAtMs: number | null;
  sockets: { size: number };
}

/**
 * Whether this tick should close a finished server (ADR 0059): its results
 * are saved and either nobody is left to serve, or the straggler grace ran
 * out on whoever is. The caller owns the once-guard (`closeRequested`) and
 * the actual close — this only answers.
 */
export const terminalCloseDue = (rt: CloseRuntime, nowMs: number): boolean => {
  if (rt.closeRequested || rt.resultsSavedAtMs === null) return false;
  return rt.sockets.size === 0 || nowMs - rt.resultsSavedAtMs > MATCH_OVER_CLOSE_GRACE_MS;
};

/**
 * The Match's fixed 30 Hz loop (ADR 0004; `tickScheduler.ts` holds it to a
 * true 30 Hz, ADR 0109): advance the phase, apply each
 * client's input for *this* tick number (ADR 0027), step the shared
 * simulation, then broadcast a snapshot at the snapshot rate (ADR 0020).
 *
 * Everything it reads and writes lives on {@link MatchRuntime} — the loop owns
 * no state of its own beyond the two counters below, which is what lets the
 * connection handler and the Lobby handlers sit in other files and still be
 * talking about the same Match.
 *
 * Returns the scheduler so the server can stop it on close.
 */
export interface MatchLoopHooks {
  /** Fired once when a finished server should close itself (ADR 0059) — the server owns the actual close. */
  onTerminalClose?: () => void;
  /** Tick timing (M13 ticket 02), present only when the process asked for it. */
  perf?: TickPerf | null;
}

export const startMatchLoop = (rt: MatchRuntime, hooks?: MatchLoopHooks): TickScheduler => {
  let consecutiveTickFailures = 0;
  // Snapshot rate is decoupled from the tick rate (ADR 0020): the sim steps
  // every tick, but a snapshot goes out only every `1000 / SNAPSHOT_HZ` ms of
  // simulated time. At M2's 30/30 that is every tick; the accumulator lets the
  // 12-player path drop to 20 Hz later with no other change.
  const SNAPSHOT_INTERVAL_MS = 1000 / SNAPSHOT_HZ;
  let snapshotAccumulatorMs = 0;
  const perf = hooks?.perf ?? null;
  /** `dueMs` is the tick's own grid time from the scheduler (ADR 0109) — what its snapshot is stamped with. */
  const runTick = (dueMs: number): void => {
    // The Match loop must survive a bad tick (a physics edge case, a NaN) —
    // one hiccup crashing the process would drop every connected player. Log
    // and carry on; the next tick usually recovers (ADR 0011).
    // The tick about to be simulated — NOT yet committed to `serverTick`.
    // `RapierSimulation.tick()` only advances its own `tickCount` (echoed as
    // `state.tick`, and what the client's tick numbering is seeded/synced
    // against) after `world.step()` succeeds. If it throws below, `serverTick`
    // must stay right where it is so the next interval retries this exact
    // same tick number — advancing it unconditionally here would leave
    // `serverTick` permanently ahead of `state.tick` after just one failed
    // tick, silently breaking "physics steps == inputs applied by tick
    // number" (ADR 0027) for the rest of the Match.
    const thisTick = rt.serverTick + 1;
    // Set only on the ROUND_END → RESULTS tick (below) — reused as `state`
    // further down instead of a second `rt.simulation.snapshot()` call
    // (code review), since nothing mutates the simulation between the two
    // points on that specific tick.
    let precomputedState: SimState | undefined;
    try {
      // Decided before anything is simulated, and committed below only once
      // the tick has actually succeeded — the same discipline `serverTick`
      // itself follows, so a failed tick retries this exact decision rather
      // than advancing the Match past a Tick that never ran.
      const nextMatch = advanceMatchPhase(rt.match, {
        tick: thisTick,
        connectedPlayers: rt.sockets.size,
        startRequested: rt.startRequested,
        // ADR 0089: the Countdown waits for every client's world, with no
        // ceiling past it. Read live, like `standingsConfirmed`.
        everyoneLoaded: rt.allLoaded(),
        countdownMs: rt.config.countdownMs,
        roundEndMs: rt.config.roundEndMs,
        allQualified: rt.roundEnding.allQualified,
        timeExpired: rt.roundEnding.timeExpired,
        roundsRemaining: rt.canContinueMatch(),
        nextRoundReady: rt.nextRoundReady,
        standingsConfirmed: rt.allStandingsConfirmed(),
        standingsReadyTimeoutMs: rt.config.standingsReadyTimeoutMs,
      });
      // Whether input is actually applied — locked outside RUNNING (ADR
      // 0040), locked per-Character on Qualification (ADR 0039), and every
      // Round type's own rule after that — is entirely `RapierSimulation.tick`'s
      // own call now (M5 ticket 01, ADR 0044): this loop just hands it every
      // connected Character's raw applied input and the phase it decided,
      // never a pre-substituted one. The ack bookkeeping inside `takeFor`
      // stays honest whatever the phase — the client is still reconciling
      // against these Ticks even while locked.
      const tickInputs: Record<string, SimInputs> = {};
      for (const id of rt.sockets.keys()) tickInputs[id] = rt.inputs.takeFor(id, thisTick);

      rt.simulation.tick(tickInputs, nextMatch.phase);
      rt.serverTick = thisTick;
      // A one-shot edge, spent the instant a tick reads it whether or not it
      // actually caused a transition — otherwise a request left stale by (say)
      // everyone leaving in the same instant it fired could cause a spurious
      // Countdown the moment anyone next connects.
      //
      // Spent *here*, with `serverTick`, and not before the step above: that
      // step is exactly what the surrounding try/catch exists to survive, and
      // it deliberately leaves `serverTick` and `match` uncommitted so the
      // same tick retries. Clearing it earlier would let a single failed
      // tick swallow the host's start — the retry would read
      // `startRequested: false`, the Match would sit in LOBBY, and the click
      // would have done nothing with no indication why.
      rt.startRequested = false;
      // The Round's clock starts the Tick the Countdown ends, not when the
      // server did (M4 ticket 03's anchor, now owned by this transition).
      // Checkpoint arrivals (ADR 0088) count from the same anchor.
      if (nextMatch.phase === "RUNNING" && rt.match.phase !== "RUNNING") {
        rt.roundStartTick = thisTick;
        rt.checkpointArrivals = {};
      }
      // Read once and reused below (code review, ticket 05) — the same
      // immutable value for the whole tick, so "which Round type is this"
      // can never silently disagree between the two places that ask it.
      const isSurvival = rt.roundRules.fallBehavior === "eliminate";
      // A Survival Round's own ending Qualifies whoever it left standing,
      // all at once — the Race-shaped sibling already stamps `finishTick`
      // continuously, per-Character, from inside the shared step itself
      // (crossing the Finish Zone), so only Survival needs this (M5 ticket
      // 05, ADR 0042). Exactly once, the Tick the transition actually
      // happens — before `state` is built below, so this same snapshot
      // already shows survivors Qualified.
      if (nextMatch.phase === "ROUND_END" && rt.match.phase === "RUNNING" && isSurvival) {
        rt.simulation.qualifySurvivors(thisTick);
      }
      // A Round's own result is appended the moment it actually ends (M7
      // ticket 04, ADR 0049) — read from this exact simulation, not from
      // `state` built later in this same tick: identical timing to
      // `qualifySurvivors` just above, and for the same reason (Score has
      // to see this Round's own Survivor Qualification too). Stashed in
      // `precomputedState` rather than snapshotting a second time below
      // (code review) — safe because this branch and the COUNTDOWN-rebuild
      // branch further down are mutually exclusive on one tick (`nextMatch.phase`
      // is either "RESULTS" or "COUNTDOWN", never both), so `rt.simulation`
      // is still the identical, unmutated world by the time `state` is read.
      if (nextMatch.phase === "RESULTS" && rt.match.phase === "ROUND_END") {
        // ADR 0110: when these Standings move on without everyone's Ready —
        // the Tick `advanceMatchPhase` times out on, on this Tick's grid.
        rt.standingsDeadlineMs = dueMs + msToTicks(rt.config.standingsReadyTimeoutMs) * TICK_MS;
        precomputedState = rt.simulation.snapshot();
        const finished = buildRoundResult(precomputedState.characters, [...rt.lobbyPlayers.values()], rt.dnf);
        // This Round's number for betting — the pool it opened as
        // (`rt.round`, set on LOADING entry), whether or not the Round below
        // turns out to have been played at all.
        const roundNumber = rt.round;
        // A Round every racer left mid-run (all rows DNF — found live
        // 2026-09-18) is not a result: persisting its `rows: []` is exactly
        // what the API's own validation refuses, which left the terminal
        // save retrying a 400 forever and the server open for good. It is
        // not counted, and it ends the Match (`matchAbandoned`): whoever was
        // racing is gone, and whatever earlier Rounds were actually played
        // still save through the terminal branch below.
        const played = finished.rows.length > 0;
        if (played) {
          rt.roundResults.push(finished);
          // Parallel to `roundResults` above: this Round's Track id, read off
          // the world it was actually raced on (`rt.fetched` still points at
          // this Round — the next Round's draw assigns it later). The career
          // history names its rows from this; the API resolves display names.
          rt.roundTrackIds.push(rt.fetched.id);
        } else {
          rt.matchAbandoned = true;
        }
        // Ticket 14: the Round's winners settle its betting pool — placement
        // 1 takes it, ties share it; an abandoned Round settles with no
        // winners rather than leaving its pool open. Fire-and-forget: a down
        // API strands the settlement in the server log, never the Match (the
        // notifier swallows).
        void rt.betting.settleRound({
          matchId: rt.config.matchId,
          round: roundNumber,
          winnerIds: roundWinners(finished),
        });
        // ADR 0088: a Race Round's authed finishers report their run times
        // for Personal Bests — exact, from Ticks, and only in a Race (a
        // Survival Round stamps `finishTick` on every survivor at its end,
        // which is not a run). `roundStartTick` is still this Round's here.
        if (played && !isSurvival) {
          const runs = Object.entries(precomputedState.characters).flatMap(([id, character]) => {
            if (character.finishTick === null) return [];
            const accountId = rt.lobbyPlayers.get(id)?.accountId ?? rt.dnf.find((d) => d.id === id)?.accountId;
            // Clamped: a Finish Zone on the spawn stamps `finishTick` during the
            // Countdown, before the clock's anchor.
            const raceTimeMs = Math.max(0, Math.round((character.finishTick - rt.roundStartTick) * TICK_MS));
            return accountId ? [{ accountId, raceTimeMs }] : [];
          });
          if (runs.length > 0) {
            void rt.personalBests.recordRuns({ trackId: rt.fetched.id, matchId: rt.config.matchId, runs });
          }
        }
        // ADR 0059: every finished Round names its racers and their falls for
        // the results save — accumulated here, every Round, because a Player
        // who drops later has no row left to read at Match end. A second
        // `buildResults` next to `buildRoundResult`'s own above (pure and
        // cheap): nicknames and falls are display data, not score, so they
        // stay out of `RoundResult` itself. An abandoned Round has only DNF
        // rows, which this loop skips anyway — `played` just keeps the two
        // reads consistent.
        const detailed = played ? buildResults(precomputedState.characters, [...rt.lobbyPlayers.values()], rt.dnf) : [];
        for (const row of detailed) {
          if (row.dnf) continue;
          rt.matchNicknames.set(row.id, row.nickname);
          // M9 ticket 11 phase 2b: the Account behind this racer, when the
          // seat authed — read off the live row (or the drop record when the
          // row is already gone), never off the display projection above.
          const accountId = rt.lobbyPlayers.get(row.id)?.accountId ?? rt.dnf.find((d) => d.id === row.id)?.accountId;
          if (accountId) rt.matchAccountIds.set(row.id, accountId);
          // The equipped cosmetics, from the same two places — the podium wears these.
          const color = rt.lobbyPlayers.get(row.id)?.color ?? rt.dnf.find((d) => d.id === row.id)?.color;
          if (typeof color === "number") rt.matchColors.set(row.id, color);
          const skin = rt.lobbyPlayers.get(row.id)?.skin ?? rt.dnf.find((d) => d.id === row.id)?.skin;
          if (skin) rt.matchSkins.set(row.id, skin);
          const hat = rt.lobbyPlayers.get(row.id)?.hat ?? rt.dnf.find((d) => d.id === row.id)?.hat;
          if (hat) rt.matchHats.set(row.id, hat);
          rt.totalFalls[row.id] = (rt.totalFalls[row.id] ?? 0) + row.fallCount;
        }
        // ADR 0110: the career's GRABS BROKEN and BEST SURVIVAL, off the world
        // this Round was played in. Time alive runs from the Round's start to
        // its elimination, or to the Round's end for whoever was still in it.
        for (const [id, won] of Object.entries(rt.simulation.strugglesWon())) {
          rt.matchGrabsBroken.set(id, (rt.matchGrabsBroken.get(id) ?? 0) + won);
        }
        if (played && isSurvival) {
          // `rt.match` is still ROUND_END here: its start is the Round's end.
          const times = survivalTimesMs(precomputedState.characters, rt.roundStartTick, rt.match.phaseStartTick);
          for (const [id, aliveMs] of Object.entries(times)) {
            rt.matchSurvivalMs.set(id, Math.max(rt.matchSurvivalMs.get(id) ?? 0, aliveMs));
          }
        }
        if (rt.canContinueMatch()) {
          // The whole Match's structure was already kicked off back when
          // `start` fired (`lobby.ts`) — Round 1 alone almost always
          // outlasts that fetch, so `matchStructurePromise` has usually
          // long since settled by the time any later Round needs it. This
          // is the seam ticket 04 left for it: a per-Round `await` that
          // used to have nothing to wait on.
          rt.nextRoundReady = false;
          void (async () => {
            await rt.matchStructurePromise;
            rt.nextRoundReady = true;
          })();
        } else {
          // Terminal RESULTS: the Match is over, its results save now
          // (ADR 0059). One attempt here, on the entry tick; the per-tick
          // check below retries while unsaved and closes once saved.
          saveMatchResultIfDue(rt, thisTick);
        }
      }
      // A fresh Countdown is a fresh Round: last Round's DNFs are not this
      // Round's (M4 ticket 05) — true whether the fresh Countdown came from
      // the Lobby or from Results (M7 ticket 04). `standingsReady` is the
      // same lifetime (M7 ticket 10, ADR 0051) — a Ready click confirms one
      // Round's own Standings, not the next one's.
      if (nextMatch.phase === "LOADING" && rt.match.phase !== "LOADING") {
        rt.dnf = [];
        rt.standingsReady.clear();
        // Nobody has this Round's world yet (ADR 0089) — including whoever
        // reported for the Round that just ended.
        rt.loaded.clear();
        rt.round = rt.roundResults.length + 1;
        rt.standingsDeadlineMs = null;
        // Ticket 14: a fresh Countdown opens a fresh betting Round — roster,
        // Round number and close time go to the API, which owns pools from
        // here. Fire-and-forget: no round row reads as closed, never as open.
        void rt.betting.openRound(
          openBettingArgs({
            matchId: rt.config.matchId,
            finishedRounds: rt.roundResults.length,
            players: rt.lobbyPlayers,
            sidelined: rt.spectators,
            nowMs: Date.now(),
          }),
        );
      }
      if (nextMatch.phase === "LOADING" && rt.match.phase === "RESULTS") {
        // M7 ticket 04/05: a Match's later Rounds go straight from Standings
        // into the next Countdown, never through the Lobby. Same "rebuild
        // the world, not just reset the phase" discipline the LOBBY branch
        // below already follows (M5 ticket 08) — an eliminated Character
        // must come back properly, not carry its disabled collider in.
        //
        // The drawn entry for this Round (ticket 05) — absent only if its
        // own draw failed (`buildMatchStructure`'s own try/catch already
        // logged why), in which case replaying whatever `fetched` already
        // points at is the same graceful fallback ticket 04's own
        // placeholder always did.
        const drawn = rt.matchStructure[rt.roundResults.length];
        if (drawn) {
          rt.fetched = drawn.fetched;
          rt.roundType = drawn.roundType;
        }
        rt.startNextRound(rt.fetched.track);
        // M9 ticket 16: this Round counts as a play on its own Track.
        // Reported here, after `fetched` points at the new Round — not up
        // next to betting's open, where `fetched` is still the previous
        // Round's Track and the play would credit the wrong row.
        void rt.trackPlays.recordPlay(rt.fetched.id);
      } else if (nextMatch.phase === "LOBBY" && rt.match.phase !== "LOBBY") {
        // ADR 0059: leaving a *finished* Match never reopens a Lobby around
        // it. Saved → this server is done, close it (rebuilding a world just
        // to throw the server away would be pure waste). Still saving (everyone
        // left in the milliseconds between the terminal tick and the save
        // landing) → hold this phase uncommitted until the save lands — the
        // per-tick check below retries it — then close on a later tick.
        if (rt.match.phase === "RESULTS" && !rt.canContinueMatch()) {
          if (rt.resultsSavedMatchId !== null) {
            rt.match = nextMatch;
            if (!rt.closeRequested) {
              rt.closeRequested = true;
              hooks?.onTerminalClose?.();
            }
          }
        } else {
          // Every way back to a Lobby gets a genuinely fresh one, never a
          // resumed one: the host going again from Results (M4 ticket 08), and
          // the last Player leaving mid-Round (`advanceMatchPhase`'s "a Round
          // with nobody in it is over").
          //
          // Both need the world rebuilt, not just the phase reset (M5 ticket
          // 08, found live). Since ticket 04 a Character that drops mid-Round
          // is *marked* eliminated rather than removed (ADR 0042) — right for
          // the Round it was racing, and wrong forever after: if that drop was
          // the last one, the phase snapped back to LOBBY around a world still
          // holding its body. Those ghosts then counted as connected Players on
          // every client's HUD, and — because `allQualified` needs a
          // `finishTick` from *every* Character and a ghost can never earn one
          // — no Race on that server could ever again end by everyone
          // Qualifying, only by running out its clock.
          //
          // Everyone still connected gets a fresh Round on the same Track,
          // re-seated at their spawn slot. Last Round's DNFs are not this
          // Round's (same reasoning as the Countdown-triggered clear above),
          // and everyone's Ready goes back to false — otherwise a Lobby the
          // host returns to would start itself the instant it existed, since
          // both Players necessarily left the last Round Ready.
          rt.resetToFreshLobby(rt.fetched.track);
          rt.dnf = [];
          rt.standingsReady.clear();
          for (const player of rt.lobbyPlayers.values()) player.ready = false;
        }
      } else if (nextMatch.phase === "LOADING" && rt.match.phase === "LOBBY") {
        // M9 ticket 16: Round 1 starts on the Lobby's own loaded Track — no
        // draw, no rebuild, so this branch is the only place its play gets
        // reported (later Rounds report from the RESULTS branch above, after
        // their own draw lands).
        void rt.trackPlays.recordPlay(rt.fetched.id);
        rt.match = nextMatch;
      } else {
        rt.match = nextMatch;
      }
      // ADR 0059, every tick in a terminal RESULTS: a save that failed (a
      // down API) retries here until it lands, and once it has, the server
      // is done — it closes as soon as everyone has left for the results
      // page, or past the grace even with stragglers still connected.
      if (rt.match.phase === "RESULTS" && !rt.canContinueMatch()) {
        if (rt.resultsSavedMatchId === null) saveMatchResultIfDue(rt, thisTick);
        else if (terminalCloseDue(rt, Date.now())) {
          rt.closeRequested = true;
          hooks?.onTerminalClose?.();
        }
      }
      consecutiveTickFailures = 0;

      // Built every tick, not just when a snapshot goes out: the Round's own
      // endings are read off it, and they should not be noticed only as often
      // as the snapshot rate happens to be (ADR 0020 decouples the two).
      const state = precomputedState ?? rt.simulation.snapshot();
      for (const [id, character] of Object.entries(state.characters)) {
        character.lastInputTick = rt.inputs.lastInputTick(id);
      }
      // Every Tick, not every snapshot: a split is only as exact as the
      // arrival Tick it was read on (ADR 0088).
      if (rt.match.phase === "RUNNING") recordCheckpointArrivals(rt.checkpointArrivals, state.characters, rt.serverTick);

      // Before the Round is RUNNING none of its clock has been spent, so it
      // reads its full authored value rather than counting down in the Lobby.
      // `rt.roundRules` is resolved once, before COUNTDOWN (ADR 0041) —
      // nothing here re-resolves it or reads Track/override separately.
      const timeLimitMs = rt.roundRules.timeLimitMs;
      // Before a Round the clock reads its full authored value; during one it
      // counts down; after one it stops where it stopped.
      let timeLeftMs: number;
      if (rt.match.phase === "RUNNING") {
        timeLeftMs = roundTimeLeftMs(timeLimitMs, rt.serverTick - rt.roundStartTick);
        rt.finalTimeLeftMs = timeLeftMs;
      } else if (rt.match.phase === "ROUND_END" || rt.match.phase === "RESULTS") {
        timeLeftMs = rt.finalTimeLeftMs;
      } else {
        timeLeftMs = timeLimitMs;
      }
      // Both endings, decided by the server from state it already owns (ADR
      // 0040) — whichever happens first ends the Round. Which Round-shaped
      // ending applies is `roundRules.fallBehavior`'s own call (M5 ticket
      // 05) — `advanceMatchPhase` itself stays Round-type-agnostic either
      // way: this is still the one `allQualified` field it has always read,
      // just fed a different Round type's own answer to "has this Round's
      // condition been met," never a third mechanism alongside it.
      rt.roundEnding = {
        allQualified: isSurvival ? survivorTargetReached(state.characters, rt.roundRules.survivorTarget) : allQualified(state.characters),
        timeExpired: rt.match.phase === "RUNNING" && timeLeftMs === 0,
      };
      // ADR 0110: the board stays open while two or more are still running,
      // and closes the Tick only one is left. Fire-and-forget, once a Round.
      if (rt.match.phase === "RUNNING" && rt.bettingClosedRound !== rt.round && runnersLeft(state.characters) <= 1) {
        rt.bettingClosedRound = rt.round;
        void rt.betting.closeRound({ matchId: rt.config.matchId, round: rt.round });
      }

      snapshotAccumulatorMs += TICK_MS;
      if (snapshotAccumulatorMs < SNAPSHOT_INTERVAL_MS) return;
      snapshotAccumulatorMs -= SNAPSHOT_INTERVAL_MS;
      // Per-client payload: `serverTimeMs` is the same for all, `commandQueueDepth`
      // is this client's own un-applied input backlog (feeds its LEAD, ADR 0021).
      // One `JSON.stringify` per client — negligible at M2 scale, and the shape
      // binary + delta encoding will need anyway.
      //
      // `serverTimeMs` is when this tick was *due*, not `performance.now()`
      // here (ADR 0109): the moment it happened to run carries the timer's
      // lateness and this tick's own work, a few ms that differ every
      // snapshot, and the client anchors its server clock, the Countdown's end
      // and the run stopwatches on it. Same `performance.now()` timeline as
      // the pong, so TimeSync's offset (ADR 0019) and ADR 0027's tick estimate
      // still hold.
      const serverTimeMs = dueMs;
      const countdown = countdownMsLeft(rt.match, rt.serverTick, rt.config.countdownMs);
      // Only while these Standings can actually move on: a terminal RESULTS
      // never starts another Round.
      const standingsDeadline = rt.match.phase === "RESULTS" && rt.canContinueMatch() ? rt.standingsDeadlineMs : null;
      // Idle phases (ADR 0057) — LOBBY and RESULTS, where input is locked,
      // the world doesn't step, and the clock doesn't run: the full payload
      // below would be byte-identical 15× a second, so broadcast only when
      // the shared (non-per-client) content actually changed, or when a join
      // set `snapshotDirty` (a newcomer has nothing yet). Level-triggered,
      // never edge-triggered: two mutations within one tick still send the
      // final state, and nothing can be lost by a missed "event". COUNTDOWN
      // stays live (`countdownMsLeft` ticks every tick) and so do RUNNING
      // and the short ROUND_END hold.
      const livePhase = rt.match.phase === "COUNTDOWN" || rt.match.phase === "RUNNING" || rt.match.phase === "ROUND_END";
      // The Race HUD's live placements and splits (ADR 0088) — once per
      // snapshot, shared by every client, and only while a Race is being run.
      const liveRace: LiveRace | null =
        !isSurvival && (rt.match.phase === "RUNNING" || rt.match.phase === "ROUND_END")
          ? {
              places: liveRacePlaces(state.characters, rt.raceTargets),
              splits: checkpointSplits(rt.checkpointArrivals, state.characters),
            }
          : null;
      // Built once per snapshot, not once per client — every connected
      // client sees the identical Lobby (M4 ticket 07), and `hostId` is
      // recomputed from who's here now rather than stored anywhere.
      const lobbyPlayerList = [...rt.lobbyPlayers.values()];
      const blockedReason = rt.startBlockedReason();
      // roundPicks[i] is Round (i + 2)'s pick — index 0 is `pendingRoundPicks`
      // key 1 (M7 ticket 05; Round 1 has its own pick mechanism, `trackId`/
      // `roundType` above). An unpicked slot reports both fields `null`
      // rather than being omitted — "do not reveal a drawn Track early"
      // means this array only ever carries the host's own explicit choices,
      // never the server's.
      const roundPicks = Array.from({ length: Math.max(rt.matchLength - 1, 0) }, (_, i) => {
        const pick = rt.pendingRoundPicks.get(i + 1);
        return { trackId: pick?.trackId ?? null, roundType: pick?.roundType ?? null };
      });
      const lobbySnapshot = {
        hostId: resolveHostId(lobbyPlayerList),
        players: lobbyPlayerList,
        // The host's Round-type pick and why (if at all) it can't start on
        // this Track — both shown to everyone before the start (M5 ticket
        // 07), not discovered when the Round behaves unexpectedly.
        roundType: rt.roundType,
        ...(blockedReason !== undefined ? { startBlockedReason: blockedReason } : {}),
        matchLength: rt.matchLength,
        roundPicks,
      };
      if (!livePhase) {
        // Deliberately everything *except* `state`: the tick number inside
        // it advances every interval even in an idle phase, which would make
        // this comparison useless — and the world it describes can't move
        // there anyway (no `world.step()`, locked input), so there is no
        // content in it a client could be missing.
        const sharedJson = JSON.stringify({
          matchId: rt.config.matchId,
          phase: rt.match.phase,
          lobby: lobbySnapshot,
          trackId: rt.fetched.id,
          trackRevision: rt.fetched.revision,
          roundRules: rt.roundRules,
          timeLeftMs,
          countdown,
          dnf: rt.dnf,
          standingsReady: [...rt.standingsReady],
          loaded: [...rt.loaded],
          round: rt.round,
          standingsDeadlineMs: standingsDeadline,
          roundResults: rt.roundResults,
          roundsRemaining: rt.canContinueMatch(),
          matchOver: rt.resultsSavedMatchId === null ? null : { matchId: rt.resultsSavedMatchId },
          liveRace,
        });
        if (!shouldBroadcastIdle(rt.snapshotDirty, sharedJson, rt.lastBroadcastJson)) return;
        rt.snapshotDirty = false;
        rt.lastBroadcastJson = sharedJson;
      } else {
        // A live broadcast reaches every connected socket, newcomer
        // included — no pending push survives past it.
        rt.snapshotDirty = false;
      }
      const sendStarted = perf ? performance.now() : 0;
      for (const [id, socket] of rt.sockets) {
        if (socket.readyState !== socket.OPEN) continue;
        trySend(
          socket,
          JSON.stringify({
            type: "snapshot",
            matchId: rt.config.matchId,
            state,
            serverTimeMs,
            commandQueueDepth: rt.inputs.depth(id),
            timeLeftMs,
            phase: rt.match.phase,
            roundRules: rt.roundRules,
            countdownMsLeft: countdown,
            dnf: rt.dnf,
            standingsReady: [...rt.standingsReady],
            loaded: [...rt.loaded],
            trackId: rt.fetched.id,
            trackRevision: rt.fetched.revision,
            lobby: lobbySnapshot,
            round: rt.round,
            standingsDeadlineMs: standingsDeadline,
            roundResults: rt.roundResults,
            // Recomputed here, not reused from the `advanceMatchPhase` call
            // above (code review): that one deliberately reads the
            // pre-Round-result-push state (whether *this* transition should
            // happen), while a client needs whether the Match can continue
            // as of *this* snapshot — after the push, on the exact tick a
            // Round ends, those two disagree by one `RoundResult`.
            roundsRemaining: rt.canContinueMatch(),
            // ADR 0059: set once the terminal save lands (never before),
            // which is also a payload change the idle check above pushes.
            matchOver: rt.resultsSavedMatchId === null ? null : { matchId: rt.resultsSavedMatchId },
            liveRace,
          } satisfies ServerMessage),
        );
      }
      perf?.recordSend(performance.now() - sendStarted, rt.match.phase);
    } catch (err) {
      // Rate-limit the log: a persistently broken sim shouldn't spam 30×/s.
      if (consecutiveTickFailures % TICK_RATE_HZ === 0) {
        console.error(`DON'T FALL: tick failed (${consecutiveTickFailures + 1}), continuing`, err);
      }
      consecutiveTickFailures += 1;
    }
  };
  if (!perf) return startTickScheduler(runTick);
  return startTickScheduler((dueMs) => {
    const started = performance.now();
    runTick(dueMs);
    perf.recordTick(performance.now() - started, rt.match.phase, rt.sockets.size, rt.simulation.lastTickTimings());
  });
};
