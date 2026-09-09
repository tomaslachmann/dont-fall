import {
  MAX_MATCH_LENGTH,
  MIN_MATCH_LENGTH,
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
 * pick, start, and a Standings-Screen Ready confirmation (M7 ticket 10, ADR
 * 0051) — all travelling the same socket every other message does, with no
 * second transport.
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

  if (message.type === "setMatchLength" && typeof message.matchLength === "number") {
    // Host-only and LOBBY-only, the same discipline as `setRoundType` —
    // and bounded server-side (M7 ticket 05) rather than clamped, the same
    // "ignore an out-of-range request" idiom the Time Limit/Survivor
    // Target publish-time bounds use, just enforced here instead of at
    // publish since a Match length is never authored onto a Track.
    //
    // Also refused once `startRequested` (code review): `rt.match.phase`
    // only actually becomes non-LOBBY on the tick loop's *next* tick, so
    // without this a Match length sent in that ~33ms window would still
    // pass the LOBBY check and mutate `matchLength` out from under
    // `buildMatchStructure`'s own array, already sized off the old value.
    if (rt.match.phase !== "LOBBY" || rt.startRequested || resolveHostId([...rt.lobbyPlayers.values()]) !== id) return true;
    if (!Number.isInteger(message.matchLength) || message.matchLength < MIN_MATCH_LENGTH || message.matchLength > MAX_MATCH_LENGTH) return true;
    rt.setMatchLength(message.matchLength);
    return true;
  }

  if (
    message.type === "pickRoundSlot" &&
    Number.isInteger(message.roundIndex) &&
    (message.trackId === null || typeof message.trackId === "string") &&
    (message.roundType === null || ROUND_TYPES.includes(message.roundType))
  ) {
    // Host-only and LOBBY-only, the same discipline as `selectTrack` (M7
    // ticket 05). `roundIndex` 0 is Round 1's own slot, which has its own
    // pick mechanism already (`selectTrack`/`setRoundType`) — not a second
    // one here — and anything at or past `matchLength - 1` doesn't
    // correspond to a Round this Match will actually play. Also refused
    // once `startRequested` — same reasoning as `setMatchLength` above: a
    // pick arriving in the post-`start`, pre-tick window would otherwise be
    // silently accepted into `pendingRoundPicks` yet never consulted, since
    // `buildMatchStructure` may already be past that slot.
    if (rt.match.phase !== "LOBBY" || rt.startRequested || resolveHostId([...rt.lobbyPlayers.values()]) !== id) return true;
    if (message.roundIndex < 1 || message.roundIndex >= rt.matchLength) return true;
    rt.pickRoundSlot(message.roundIndex, { trackId: message.trackId, roundType: message.roundType });
    return true;
  }

  if (message.type === "start") {
    // Enforced here, not by whichever client happens to click: host
    // only, LOBBY only, enough Players, everyone Ready (ADR 0040). A
    // request that fails any of these is simply ignored — the host's
    // own UI is what keeps a non-host from ever sending this for real,
    // so a client that sends it anyway gets no error, just silence.
    //
    // `rt.startRequested` is also this message's own re-entrancy guard
    // (code review, M7 ticket 05): `rt.match.phase` alone doesn't change
    // until the tick loop's next tick, so a double-send (a double-click,
    // no client debounce) arriving in that window used to pass the LOBBY
    // check twice and kick off two concurrent `buildMatchStructure()`
    // calls racing on the same `usedTrackIds`/`matchStructure`.
    if (rt.match.phase !== "LOBBY" || rt.startRequested) return true;
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
    // Set before kicking off the draw, not after (code review): the guard
    // above is what makes it a re-entrancy lock at all, and a `start`
    // arriving between the two would otherwise slip through.
    rt.startRequested = true;
    // M7 ticket 05: draw whatever Round slots after the first the host
    // left unpicked, kicked off now rather than awaited here — Round 1 is
    // about to play with whatever's already loaded regardless, and by the
    // time it ends this draw has almost always long since finished. Not
    // awaited: a slow track-service must not delay the Countdown the host
    // just asked for.
    rt.matchStructurePromise = rt.buildMatchStructure();
    return true;
  }

  if (message.type === "standingsReady") {
    // RESULTS-only, unlike every other Lobby/Match-structure message here —
    // deliberately **not** host-gated (M7 ticket 10, ADR 0051): every
    // connected Player confirms their own. `sockets.has` rather than
    // `lobbyPlayers`, matching `allStandingsConfirmed`'s own read — the two
    // stay in step one-for-one, but this is the one that actually matters
    // for "is this a live connection."
    if (rt.match.phase !== "RESULTS" || !rt.sockets.has(id)) return true;
    rt.standingsReady.add(id);
    return true;
  }
  return false;
};
