import type { FriendPresence } from "@dont-fall/shared";

/**
 * One live lobby seat, as friends presence reads it (M9 ticket 12) — the
 * lobbies' `/status` rosters inverted to account → seat. Never stored: read
 * live at request time, so activity can never go stale.
 */
export type LobbySeat = {
  lobbyId: string;
  phase: string;
  round: number | null;
  playerCount: number;
  maxPlayers: number;
} & ({ isPrivate: true; code: string } | { isPrivate: false });

/** A beat this fresh reads online — the client beats every 30s, so three missed beats still hold. */
export const ONLINE_WINDOW_MS = 90_000;
/** Past this a silent Account reads offline — between the windows, idle. */
export const IDLE_WINDOW_MS = 10 * 60_000;

/**
 * Derives every requested Account's presence (M9 ticket 12) — pure, so the
 * windows and the roster's authority are pinned without HTTP or a clock.
 * A live seat always wins (the socket is authoritative — no heartbeat can
 * overrule being seated); seatless Accounts fall back to beat age. Window
 * edges belong to the fresher status.
 */
export const derivePresence = (
  accountIds: string[],
  beats: Map<string, number>,
  seats: Map<string, LobbySeat>,
  nowMs: number,
): Map<string, FriendPresence> => {
  const out = new Map<string, FriendPresence>();
  for (const id of accountIds) {
    const seat = seats.get(id);
    if (seat !== undefined) {
      if (seat.phase === "LOBBY") {
        out.set(id, {
          status: "in-lobby",
          slotsOpen: Math.max(0, seat.maxPlayers - seat.playerCount),
          lobby: seat.isPrivate ? { kind: "private", code: seat.code } : { kind: "public", lobbyId: seat.lobbyId },
          joinable: seat.playerCount < seat.maxPlayers,
        });
      } else {
        out.set(id, { status: "in-match", ...(seat.round === null ? {} : { round: seat.round }) });
      }
      continue;
    }
    const beat = beats.get(id);
    if (beat === undefined) {
      out.set(id, { status: "offline" });
      continue;
    }
    const age = nowMs - beat;
    if (age < ONLINE_WINDOW_MS) out.set(id, { status: "online" });
    else if (age < IDLE_WINDOW_MS) out.set(id, { status: "idle", lastSeenAt: beat });
    else out.set(id, { status: "offline", lastSeenAt: beat });
  }
  return out;
};
