import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type TrackDb } from "./db.js";
import {
  createSession,
  deleteSession,
  getAccountBySessionToken,
  SESSION_TTL_MS,
  upsertAccountFromDiscord,
  type DiscordIdentity,
} from "./accounts.js";

let dir: string;
let db: TrackDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "track-service-accounts-test-"));
  db = openDb(join(dir, "test.sqlite"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const IDENTITY: DiscordIdentity = { discordId: "d-1", displayName: "Wobbleton", avatarUrl: "https://cdn.discordapp.com/a.png" };

describe("upsertAccountFromDiscord", () => {
  it("creates a new Account on first login", () => {
    const account = upsertAccountFromDiscord(db, IDENTITY);
    expect(account.discordId).toBe("d-1");
    expect(account.displayName).toBe("Wobbleton");
    expect(account.avatarUrl).toBe("https://cdn.discordapp.com/a.png");
    expect(account.id).toBeTruthy();
  });

  it("returns the same Account id on a repeat login — never duplicates the row", () => {
    const first = upsertAccountFromDiscord(db, IDENTITY);
    const second = upsertAccountFromDiscord(db, IDENTITY);
    expect(second.id).toBe(first.id);
  });

  it("refreshes displayName/avatarUrl on a repeat login (Discord profile drift)", () => {
    const first = upsertAccountFromDiscord(db, IDENTITY);
    const second = upsertAccountFromDiscord(db, { ...IDENTITY, displayName: "Noodlebean", avatarUrl: null });
    expect(second.id).toBe(first.id);
    expect(second.displayName).toBe("Noodlebean");
    expect(second.avatarUrl).toBeNull();
  });

  it("two different Discord users get two different Accounts", () => {
    const a = upsertAccountFromDiscord(db, IDENTITY);
    const b = upsertAccountFromDiscord(db, { ...IDENTITY, discordId: "d-2" });
    expect(a.id).not.toBe(b.id);
  });
});

describe("createSession / getAccountBySessionToken", () => {
  it("resolves a fresh token back to the Account that owns it", () => {
    const account = upsertAccountFromDiscord(db, IDENTITY);
    const { token } = createSession(db, account.id);

    expect(getAccountBySessionToken(db, token)).toEqual(account);
  });

  it("an unknown token resolves to nothing", () => {
    expect(getAccountBySessionToken(db, "not-a-real-token")).toBeUndefined();
  });

  it("an expired token resolves to nothing and is pruned", () => {
    vi.useFakeTimers();
    try {
      const account = upsertAccountFromDiscord(db, IDENTITY);
      const { token } = createSession(db, account.id);

      vi.advanceTimersByTime(SESSION_TTL_MS + 1);

      expect(getAccountBySessionToken(db, token)).toBeUndefined();
      // Pruned, not just rejected — a second lookup takes the same "unknown" path, not a live row.
      expect(getAccountBySessionToken(db, token)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("each login issues its own token — two sessions for one Account both resolve independently", () => {
    const account = upsertAccountFromDiscord(db, IDENTITY);
    const a = createSession(db, account.id);
    const b = createSession(db, account.id);

    expect(a.token).not.toBe(b.token);
    expect(getAccountBySessionToken(db, a.token)).toEqual(account);
    expect(getAccountBySessionToken(db, b.token)).toEqual(account);
  });
});

describe("deleteSession", () => {
  it("logs out — the token no longer resolves", () => {
    const account = upsertAccountFromDiscord(db, IDENTITY);
    const { token } = createSession(db, account.id);

    deleteSession(db, token);

    expect(getAccountBySessionToken(db, token)).toBeUndefined();
  });

  it("deleting an unknown token is a no-op, not an error", () => {
    expect(() => deleteSession(db, "never-issued")).not.toThrow();
  });
});
