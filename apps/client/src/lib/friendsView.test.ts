import { describe, expect, it } from "vitest";
import type { FriendPresence, FriendView } from "@dont-fall/shared";
import { formatAgo, recentNote, requestNote, tabOf, toFriendRow } from "./friendsView.js";

const NOW = 1_000_000_000_000;

const friend = (presence: FriendPresence): FriendView => ({
  accountId: "a1",
  displayName: "Floppo",
  avatarUrl: null,
  friendsSince: 1,
  presence,
});

describe("toFriendRow", () => {
  it("speaks the mock's own status lines, with the button gates attached", () => {
    expect(
      toFriendRow(friend({ status: "in-lobby", slotsOpen: 3, joinable: true }), NOW).status,
    ).toBe("IN LOBBY · 3 SLOTS OPEN");
    expect(toFriendRow(friend({ status: "in-lobby", slotsOpen: 1, joinable: true }), NOW).status).toBe(
      "IN LOBBY · 1 SLOT OPEN",
    );
    expect(toFriendRow(friend({ status: "in-match", round: 2 }), NOW)).toMatchObject({
      status: "IN A MATCH · ROUND 2",
      busy: true,
      joinable: false,
    });
    expect(toFriendRow(friend({ status: "in-match" }), NOW).status).toBe("IN A MATCH");
    expect(toFriendRow(friend({ status: "online" }), NOW).status).toBe("IN THE MENU");
  });

  it("a full lobby reads not joinable but stays on the roster", () => {
    expect(toFriendRow(friend({ status: "in-lobby", slotsOpen: 0, joinable: false }), NOW)).toMatchObject({
      status: "IN LOBBY · 0 SLOTS OPEN",
      joinable: false,
      busy: false,
      offline: false,
    });
  });

  it("idle and offline carry last-seen — absent only when never seen", () => {
    expect(toFriendRow(friend({ status: "idle", lastSeenAt: NOW - 5 * 60_000 }), NOW).status).toBe(
      "IDLE · 5 MINUTES AGO",
    );
    expect(toFriendRow(friend({ status: "idle" }), NOW).status).toBe("IDLE");
    expect(toFriendRow(friend({ status: "offline", lastSeenAt: NOW - 2 * 86_400_000 }), NOW)).toMatchObject({
      status: "OFFLINE · 2 DAYS AGO",
      offline: true,
    });
    expect(toFriendRow(friend({ status: "offline" }), NOW).status).toBe("OFFLINE");
  });
});

describe("formatAgo", () => {
  it("steps through JUST NOW, minutes, hours, and days", () => {
    expect(formatAgo(NOW - 30_000, NOW)).toBe("JUST NOW");
    expect(formatAgo(NOW - 60_000, NOW)).toBe("1 MINUTE AGO");
    expect(formatAgo(NOW - 59 * 60_000, NOW)).toBe("59 MINUTES AGO");
    expect(formatAgo(NOW - 3 * 3_600_000, NOW)).toBe("3 HOURS AGO");
    expect(formatAgo(NOW - 25 * 3_600_000, NOW)).toBe("1 DAY AGO");
  });
});

describe("tabOf / requestNote / recentNote", () => {
  it("slices the roster into ONLINE, IN A MATCH, and OFFLINE", () => {
    expect(tabOf(friend({ status: "online" }))).toBe("ONLINE");
    expect(tabOf(friend({ status: "idle" }))).toBe("ONLINE");
    expect(tabOf(friend({ status: "in-lobby" }))).toBe("ONLINE");
    expect(tabOf(friend({ status: "in-match" }))).toBe("IN A MATCH");
    expect(tabOf(friend({ status: "offline" }))).toBe("OFFLINE");
  });

  it("request notes only ever claim shared matches — never an invented provenance", () => {
    expect(requestNote(4)).toBe("PLAYED 4 MATCHES TOGETHER");
    expect(requestNote(1)).toBe("PLAYED 1 MATCH TOGETHER");
    expect(requestNote(0)).toBeNull();
  });

  it("recent rows always know matches together and last played", () => {
    expect(
      recentNote(
        { accountId: "a2", displayName: "Bo", avatarUrl: null, matchesTogether: 2, lastPlayedAt: NOW - 3_600_000 },
        NOW,
      ),
    ).toBe("PLAYED 2 MATCHES TOGETHER · 1 HOUR AGO");
  });
});
