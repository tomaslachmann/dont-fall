/**
 * Friends screen view mapping (M9 ticket 12) — pure, so the mock's own words
 * ("IN LOBBY · 3 SLOTS OPEN", "OFFLINE · 2 DAYS AGO") are pinned without a
 * router or a query client. The roster reads `FriendPresence` straight off
 * the wire; this module only translates it into rows and tab slices.
 */

import type { FriendPresence, FriendView, RecentPlayerView } from "@dont-fall/shared";

/** One roster row: the mock's status line plus the two button gates. */
export interface FriendRow {
  accountId: string;
  displayName: string;
  status: string;
  /** Their Lobby takes Players right now — the JOIN button's own gate. */
  joinable: boolean;
  /** Mid-match — can't be invited. */
  busy: boolean;
  offline: boolean;
}

/** The roster's four tabs — the mock's own labels. */
export type FriendsTab = "ONLINE" | "IN A MATCH" | "OFFLINE" | "RECENT";

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * "How long ago" in the mock's caps voice — `JUST NOW`, `5 MINUTES AGO`,
 * `3 HOURS AGO`, `2 DAYS AGO`.
 */
export const formatAgo = (atMs: number, nowMs: number): string => {
  const minutes = Math.max(0, Math.floor((nowMs - atMs) / 60_000));
  if (minutes < 1) return "JUST NOW";
  if (minutes < 60) return `${plural(minutes, "MINUTE", "MINUTES")} AGO`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${plural(hours, "HOUR", "HOURS")} AGO`;
  return `${plural(Math.floor(hours / 24), "DAY", "DAYS")} AGO`;
};

/** One friend's wire presence → one roster row. */
export const toFriendRow = (friend: FriendView, nowMs: number): FriendRow => {
  const presence: FriendPresence = friend.presence;
  const base = { accountId: friend.accountId, displayName: friend.displayName };
  switch (presence.status) {
    case "in-lobby":
      return {
        ...base,
        status: `IN LOBBY · ${plural(presence.slotsOpen ?? 0, "SLOT", "SLOTS")} OPEN`,
        joinable: presence.joinable ?? false,
        busy: false,
        offline: false,
      };
    case "in-match":
      return {
        ...base,
        status: presence.round === undefined ? "IN A MATCH" : `IN A MATCH · ROUND ${presence.round}`,
        joinable: false,
        busy: true,
        offline: false,
      };
    case "online":
      return { ...base, status: "IN THE MENU", joinable: false, busy: false, offline: false };
    case "idle":
      return {
        ...base,
        status: presence.lastSeenAt === undefined ? "IDLE" : `IDLE · ${formatAgo(presence.lastSeenAt, nowMs)}`,
        joinable: false,
        busy: false,
        offline: false,
      };
    case "offline":
      return {
        ...base,
        status: presence.lastSeenAt === undefined ? "OFFLINE" : `OFFLINE · ${formatAgo(presence.lastSeenAt, nowMs)}`,
        joinable: false,
        busy: false,
        offline: true,
      };
  }
};

/** Which tab a presence status belongs on — `RECENT` is separate data, never a slice. */
const TAB_BY_STATUS: Record<FriendPresence["status"], Exclude<FriendsTab, "RECENT">> = {
  online: "ONLINE",
  idle: "ONLINE",
  "in-lobby": "ONLINE",
  "in-match": "IN A MATCH",
  offline: "OFFLINE",
};

export const tabOf = (friend: FriendView): Exclude<FriendsTab, "RECENT"> => TAB_BY_STATUS[friend.presence.status];

/**
 * The request's honest context line — shared finished Matches, or nothing
 * (never an invented provenance: the server only knows matches together).
 */
export const requestNote = (matchesTogether: number): string | null =>
  matchesTogether > 0 ? `PLAYED ${plural(matchesTogether, "MATCH", "MATCHES")} TOGETHER` : null;

/** One RECENT row's context line — always known, RECENT only lists co-players. */
export const recentNote = (recent: RecentPlayerView, nowMs: number): string =>
  `PLAYED ${plural(recent.matchesTogether, "MATCH", "MATCHES")} TOGETHER · ${formatAgo(recent.lastPlayedAt, nowMs)}`;
