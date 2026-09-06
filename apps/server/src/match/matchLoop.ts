import {
  IDLE_INPUTS,
  SNAPSHOT_HZ,
  TICK_MS,
  TICK_RATE_HZ,
  advanceMatchPhase,
  allQualified,
  countdownMsLeft,
  phaseLocksInput,
  resolveHostId,
  roundTimeLeftMs,
  type ServerMessage,
  type SimInputs,
} from "@dont-fall/shared";
import { trySend } from "../net/wire.js";
import type { MatchRuntime } from "./matchRuntime.js";

/**
 * The Match's fixed 30 Hz loop (ADR 0004): advance the phase, apply each
 * client's input for *this* tick number (ADR 0027), step the shared
 * simulation, then broadcast a snapshot at the snapshot rate (ADR 0020).
 *
 * Everything it reads and writes lives on {@link MatchRuntime} — the loop owns
 * no state of its own beyond the two counters below, which is what lets the
 * connection handler and the Lobby handlers sit in other files and still be
 * talking about the same Match.
 *
 * Returns the interval handle so the server can clear it on close.
 */
export const startMatchLoop = (rt: MatchRuntime): NodeJS.Timeout => {
  let consecutiveTickFailures = 0;
  // Snapshot rate is decoupled from the tick rate (ADR 0020): the sim steps
  // every tick, but a snapshot goes out only every `1000 / SNAPSHOT_HZ` ms of
  // simulated time. At M2's 30/30 that is every tick; the accumulator lets the
  // 12-player path drop to 20 Hz later with no other change.
  const SNAPSHOT_INTERVAL_MS = 1000 / SNAPSHOT_HZ;
  let snapshotAccumulatorMs = 0;
  return setInterval(() => {
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
    try {
      // Decided before anything is simulated, and committed below only once
      // the tick has actually succeeded — the same discipline `serverTick`
      // itself follows, so a failed tick retries this exact decision rather
      // than advancing the Match past a Tick that never ran.
      const nextMatch = advanceMatchPhase(rt.match, {
        tick: thisTick,
        connectedPlayers: rt.sockets.size,
        startRequested: rt.startRequested,
        countdownMs: rt.config.countdownMs,
        roundEndMs: rt.config.roundEndMs,
        allQualified: rt.roundEnding.allQualified,
        timeExpired: rt.roundEnding.timeExpired,
        returnToLobbyRequested: rt.returnToLobbyRequested,
      });
      // A one-shot edge, spent the instant this tick reads it whether or not
      // it actually caused a transition — otherwise a request left stale by
      // (say) everyone leaving in the same instant it fired could cause a
      // spurious Countdown the moment anyone next connects.
      rt.startRequested = false;
      rt.returnToLobbyRequested = false;
      // Input is locked in every phase but RUNNING (ADR 0040). Enforced here
      // rather than by refusing the packet: the client runs the same rule on
      // its own prediction, so both sides stop and start driving the
      // Character on the identical Tick, and a client that ignores the rule
      // simply has its input replaced.
      const inputLocked = phaseLocksInput(nextMatch.phase);
      const tickInputs: Record<string, SimInputs> = {};
      for (const id of rt.sockets.keys()) {
        // The ack bookkeeping inside `takeFor` stays honest whatever the phase
        // — the client is still reconciling against these Ticks — only the
        // input actually simulated is replaced.
        const applied = rt.inputs.takeFor(id, thisTick);
        tickInputs[id] = inputLocked ? IDLE_INPUTS : applied;
      }

      rt.simulation.tick(tickInputs);
      rt.serverTick = thisTick;
      // The Round's clock starts the Tick the Countdown ends, not when the
      // server did (M4 ticket 03's anchor, now owned by this transition).
      if (nextMatch.phase === "RUNNING" && rt.match.phase !== "RUNNING") rt.roundStartTick = thisTick;
      // A fresh Countdown is a fresh Round: last Round's DNFs are not this
      // Round's (M4 ticket 05).
      if (nextMatch.phase === "COUNTDOWN" && rt.match.phase !== "COUNTDOWN") rt.dnf = [];
      if (nextMatch.phase === "LOBBY" && rt.match.phase === "RESULTS") {
        // Going again (M4 ticket 08): everyone still connected gets a fresh
        // Round on the same Track, re-seated at their spawn slot. A genuinely
        // fresh Lobby, not a resumed one: last Round's DNFs are not this
        // Round's (same reasoning as the Countdown-triggered clear above),
        // and everyone's Ready goes back to false — otherwise a Lobby the
        // host returns to would start itself the instant it existed, since
        // both Players necessarily left the last Round Ready.
        rt.resetToFreshLobby(rt.fetched.track);
        rt.dnf = [];
        for (const player of rt.lobbyPlayers.values()) player.ready = false;
      } else {
        rt.match = nextMatch;
      }
      consecutiveTickFailures = 0;

      // Built every tick, not just when a snapshot goes out: the Round's own
      // endings are read off it, and they should not be noticed only as often
      // as the snapshot rate happens to be (ADR 0020 decouples the two).
      const state = rt.simulation.snapshot();
      for (const [id, character] of Object.entries(state.characters)) {
        character.lastInputTick = rt.inputs.lastInputTick(id);
      }

      // Before the Round is RUNNING none of its clock has been spent, so it
      // reads its full authored value rather than counting down in the Lobby.
      const timeLimitMs = rt.roundTimeLimitMs();
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
      // 0040) — whichever happens first ends the Round.
      rt.roundEnding = {
        allQualified: allQualified(state.characters),
        timeExpired: rt.match.phase === "RUNNING" && timeLeftMs === 0,
      };

      snapshotAccumulatorMs += TICK_MS;
      if (snapshotAccumulatorMs < SNAPSHOT_INTERVAL_MS) return;
      snapshotAccumulatorMs -= SNAPSHOT_INTERVAL_MS;
      // Per-client payload: `serverTimeMs` is the same for all, `commandQueueDepth`
      // is this client's own un-applied input backlog (feeds its LEAD, ADR 0021).
      // One `JSON.stringify` per client — negligible at M2 scale, and the shape
      // binary + delta encoding will need anyway.
      const serverTimeMs = performance.now();
      const countdown = countdownMsLeft(rt.match, rt.serverTick, rt.config.countdownMs);
      // Built once per snapshot, not once per client — every connected
      // client sees the identical Lobby (M4 ticket 07), and `hostId` is
      // recomputed from who's here now rather than stored anywhere.
      const lobbyPlayerList = [...rt.lobbyPlayers.values()];
      const lobbySnapshot = { hostId: resolveHostId(lobbyPlayerList), players: lobbyPlayerList };
      for (const [id, socket] of rt.sockets) {
        if (socket.readyState !== socket.OPEN) continue;
        trySend(
          socket,
          JSON.stringify({
            type: "snapshot",
            state,
            serverTimeMs,
            commandQueueDepth: rt.inputs.depth(id),
            timeLeftMs,
            phase: rt.match.phase,
            countdownMsLeft: countdown,
            dnf: rt.dnf,
            trackId: rt.fetched.id,
            trackRevision: rt.fetched.revision,
            lobby: lobbySnapshot,
          } satisfies ServerMessage),
        );
      }
    } catch (err) {
      // Rate-limit the log: a persistently broken sim shouldn't spam 30×/s.
      if (consecutiveTickFailures % TICK_RATE_HZ === 0) {
        console.error(`DON'T FALL: tick failed (${consecutiveTickFailures + 1}), continuing`, err);
      }
      consecutiveTickFailures += 1;
    }
  }, TICK_MS);
};
