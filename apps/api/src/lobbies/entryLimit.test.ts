import { describe, expect, it } from "vitest";
import { ServiceError } from "../http/errors.js";
import { LobbyEntryLimit } from "./entryLimit.js";

/**
 * The entry routes' rate limit on a clock the test owns, so every window and
 * sweep here is exact. What it guards is in `entryLimit.ts`: seats reserved
 * by a caller that keeps asking and never arrives hold a Lobby's Start.
 */

/** The module's own windows, named here so each test reads as the rule it checks. */
const ENTRY_WINDOW = 10_000;
const ENTRY_MEMORY = 60_000;

const statusOf = (fn: () => void): number | undefined => {
  try {
    fn();
    return undefined;
  } catch (err) {
    if (err instanceof ServiceError) return err.statusCode;
    throw err;
  }
};

describe("LobbyEntryLimit (ADR 0112's entry routes)", () => {
  it("lets a handful of clicks through, refuses the rest of the window, and starts fresh after it", () => {
    let now = 1_000_000;
    const limit = new LobbyEntryLimit(() => now);
    const connection = {};

    // Five in ten seconds covers every honest repeat — a reload, a crash, a
    // refusal clicked through again.
    for (let i = 0; i < 5; i += 1) expect(statusOf(() => limit.take("amy", connection))).toBeUndefined();
    expect(statusOf(() => limit.take("amy", connection))).toBe(429);

    // Being turned away does not hand out a fresh window.
    now += 9_000;
    expect(statusOf(() => limit.take("amy", connection))).toBe(429);
    // Another bean's clicks are its own, on the same connection or not.
    expect(statusOf(() => limit.take("bo", connection))).toBeUndefined();

    now += 1_001;
    expect(statusOf(() => limit.take("amy", connection))).toBeUndefined();
  });

  it("counts a caller with no session by the connection it came in on", () => {
    let now = 1_000_000;
    const limit = new LobbyEntryLimit(() => now);
    const one = {};
    const other = {};

    for (let i = 0; i < 5; i += 1) limit.take(null, one);
    expect(statusOf(() => limit.take(null, one))).toBe(429);
    expect(statusOf(() => limit.take(null, other))).toBeUndefined();

    now += ENTRY_WINDOW;
    expect(statusOf(() => limit.take(null, one))).toBeUndefined();
    // Nothing of theirs is held by id: a connection's window goes with its socket.
    expect(limit.remembering()).toBe(0);
  });

  it("forgets an Account whose window is long past, so it cannot grow without bound", () => {
    let now = 1_000_000;
    const limit = new LobbyEntryLimit(() => now);
    const connection = {};
    for (const accountId of ["amy", "bo", "cy"]) limit.take(accountId, connection);
    expect(limit.remembering()).toBe(3);

    // Swept by the next call that comes in — there is no timer of its own to own.
    now += ENTRY_MEMORY;
    limit.take("di", connection);
    expect(limit.remembering()).toBe(1);

    // A bean that comes back gets a window, not what it spent an hour ago.
    for (let i = 0; i < 5; i += 1) expect(statusOf(() => limit.take("amy", connection))).toBeUndefined();
  });
});
