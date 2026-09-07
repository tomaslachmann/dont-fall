import {
  NICKNAME_MAX_LENGTH,
  ROUND_TYPES,
  allReady,
  resolveHostId,
  type ClientMessage,
  type RoundType,
} from "@dont-fall/shared";
import { fetchTrack, type FetchedTrack } from "../track/trackSource.js";
import type { MatchRuntime } from "./matchRuntime.js";

/**
 * The Lobby's own messages (M4 ticket 07, ADR 0040) — nickname, Ready, Track
 * pick, start, and the return from Results — all travelling the same socket
 * every other message does, with no second transport.
 *
 * Every gate here is enforced by the server rather than by whichever client
 * happens to send the message: host-only and phase-only checks live in this
 * file, and a request that fails one is ignored in silence, because the host's
 * own UI is what stops a non-host ever sending it for real.
 *
 * Returns whether the message was a Lobby message and has been handled.
 */
export const handleLobbyMessage = (rt: MatchRuntime, id: string, message: ClientMessage): boolean => {
  // Lobby interactions (M4 ticket 07, ADR 0040) — nickname/ready/Track
  // pick/start, all travelling this same socket, no second transport.

  if (message.type === "setNickname" && typeof message.nickname === "string") {
    // A nickname is cosmetic, never a start gate — any connected Player
    // may send this at any time, in any phase. An empty result after
    // trimming leaves the existing nickname alone rather than blanking it.
    const trimmed = message.nickname.trim().slice(0, NICKNAME_MAX_LENGTH);
    const player = rt.lobbyPlayers.get(id);
    if (player && trimmed.length > 0) player.nickname = trimmed;
    return true;
  }

  if (message.type === "setReady" && typeof message.ready === "boolean") {
    // Only meaningful in LOBBY — there is no "getting un-ready" mid-Round,
    // and honoring it there would just be silently ignored by the start
    // gate anyway, so it's simplest to only apply it here at all.
    if (rt.match.phase !== "LOBBY") return true;
    const player = rt.lobbyPlayers.get(id);
    if (player) player.ready = message.ready;
    return true;
  }

  if (message.type === "selectTrack" && typeof message.trackId === "string") {
    // Host-only and LOBBY-only, enforced by the server, not by which
    // client happens to send it (ADR 0040). Checked again after the
    // `await` below, for the identical reason the connect-time reload
    // re-checks `sockets.size` after its own fetch: the world can move
    // on while this is in flight.
    if (rt.match.phase !== "LOBBY" || resolveHostId([...rt.lobbyPlayers.values()]) !== id) return true;
    const requestedTrackId = message.trackId;
    const seq = ++rt.selectTrackSeq;
    void (async () => {
      let candidate: FetchedTrack;
      try {
        candidate = await fetchTrack(rt.config.trackServiceUrl, { ...rt.config.trackFetchRetryOptions, trackId: requestedTrackId });
      } catch (err) {
        console.warn(`DON'T FALL: Lobby selectTrack failed to load Track "${requestedTrackId}": ${(err as Error).message}`);
        return;
      }
      if (
        seq !== rt.selectTrackSeq ||
        rt.match.phase !== "LOBBY" ||
        !rt.sockets.has(id) ||
        resolveHostId([...rt.lobbyPlayers.values()]) !== id
      ) {
        // Superseded by a newer pick, or the Lobby moved on (Round
        // started, this sender left, host changed) while the fetch
        // was in flight.
        return;
      }
      const alreadyLoaded = candidate.id === rt.fetched.id && candidate.revision === rt.fetched.revision;
      if (alreadyLoaded) return;
      rt.fetched = candidate;
      rt.resetToFreshLobby(candidate.track);
      console.log(`DON'T FALL: Lobby selected Track "${rt.fetched.id}"@${rt.fetched.revision}`);
    })();
    return true;
  }

  if (message.type === "setRoundType") {
    // Host-only and LOBBY-only, the same discipline as `selectTrack` — and
    // validated against the Round types that actually exist, because this
    // is a name off the wire rather than a number: a client sending
    // anything else would otherwise put the server on a `RoundType` no
    // resolver knows, and every Round after it would resolve as a Race
    // without anyone being told why.
    if (rt.match.phase !== "LOBBY" || resolveHostId([...rt.lobbyPlayers.values()]) !== id) return true;
    if (!ROUND_TYPES.includes(message.roundType as RoundType)) return true;
    rt.setRoundType(message.roundType);
    return true;
  }

  if (message.type === "start") {
    // Enforced here, not by whichever client happens to click: host
    // only, LOBBY only, enough Players, everyone Ready (ADR 0040). A
    // request that fails any of these is simply ignored — the host's
    // own UI is what keeps a non-host from ever sending this for real,
    // so a client that sends it anyway gets no error, just silence.
    if (rt.match.phase !== "LOBBY") return true;
    const players = [...rt.lobbyPlayers.values()];
    if (resolveHostId(players) !== id) return true;
    if (rt.sockets.size < rt.config.playersToStart) return true;
    if (!allReady(players)) return true;
    // A Race needs a Finish Zone (M5 ticket 07, ADR 0041) — refused here,
    // against the Track actually loaded. Silence is fine for this one
    // *because* it is not silent: the reason has been on every snapshot's
    // `lobby.startBlockedReason` since the moment it became true, and the
    // host's own Start button is disabled by it.
    if (rt.startBlockedReason() !== undefined) return true;
    rt.startRequested = true;
    return true;
  }

  if (message.type === "returnToLobby") {
    // Host-only, RESULTS-only, same discipline as `start` (M4 ticket
    // 08): there is no auto-rematch timer, so nothing else is allowed
    // to move the Match out of RESULTS.
    if (rt.match.phase !== "RESULTS") return true;
    if (resolveHostId([...rt.lobbyPlayers.values()]) !== id) return true;
    rt.returnToLobbyRequested = true;
    return true;
  }
  return false;
};
