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
} & (
  | {
      isPrivate: true;
      code: string;
      /**
       * Whose friends this Lobby shows up for, with one-click JOIN (ADR 0110)
       * — its creator's, when WHO CAN JOIN is FRIENDS; `null` for an
       * invite-only Lobby, which no friend is shown as joinable.
       */
      friendsOf: string | null;
    }
  | { isPrivate: false }
);

/** A beat this fresh reads online — the API beats every 30s for each open Account socket (ADR 0112), so three missed beats still hold. */
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
        // ADR 0110: a private Lobby is reachable from presence only as its
        // creator's FRIENDS Lobby; otherwise the friend is just "in a Lobby".
        const shown = !seat.isPrivate || seat.friendsOf === id;
        out.set(id, {
          status: "in-lobby",
          slotsOpen: Math.max(0, seat.maxPlayers - seat.playerCount),
          ...(shown
            ? { lobby: seat.isPrivate ? { kind: "private" as const, code: seat.code } : { kind: "public" as const, lobbyId: seat.lobbyId } }
            : {}),
          joinable: shown && seat.playerCount < seat.maxPlayers,
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
