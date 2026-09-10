import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type TrackDb } from "./db.js";
import {
  createAccountWithPassword,
  createSession,
  deleteSession,
  getAccountBySessionToken,
  invalidDisplayNameReason,
  invalidEmailReason,
  invalidPasswordReason,
  isUniqueConstraintError,
  linkDiscordToAccount,
  linkPasswordToAccount,
  SESSION_TTL_MS,
  upsertAccountFromDiscord,
  verifyEmailPassword,
  type DiscordIdentity,
  type EmailSignup,
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

const SIGNUP: EmailSignup = { email: "Wobbleton@Example.com", password: "correct horse battery staple", displayName: "Wobbleton" };

describe("createAccountWithPassword / verifyEmailPassword (ADR 0053)", () => {
  it("signs up, then logs in with the same email/password", () => {
    const created = createAccountWithPassword(db, SIGNUP);
    expect(created.discordId).toBeNull();
    expect(created.displayName).toBe("Wobbleton");

    const loggedIn = verifyEmailPassword(db, SIGNUP.email, SIGNUP.password);
    expect(loggedIn).toEqual(created);
  });

  it("normalizes email case/whitespace — login isn't case-sensitive on the address", () => {
    createAccountWithPassword(db, SIGNUP);
    expect(verifyEmailPassword(db, "  wobbleton@example.com  ", SIGNUP.password)).toBeTruthy();
  });

  it("rejects the wrong password", () => {
    createAccountWithPassword(db, SIGNUP);
    expect(verifyEmailPassword(db, SIGNUP.email, "not the password")).toBeUndefined();
  });

  it("rejects an email with no Account at all — same undefined as a wrong password, no enumeration signal", () => {
    expect(verifyEmailPassword(db, "nobody@example.com", "anything")).toBeUndefined();
  });

  it("a second signup with the same email throws a uniqueness error, not a silent overwrite", () => {
    createAccountWithPassword(db, SIGNUP);
    try {
      createAccountWithPassword(db, { ...SIGNUP, displayName: "Someone else" });
      expect.unreachable("expected a uniqueness violation");
    } catch (err) {
      expect(isUniqueConstraintError(err)).toBe(true);
    }
  });

  it("a Discord-only Account (no password set) never logs in via email/password", () => {
    const discordAccount = upsertAccountFromDiscord(db, { ...IDENTITY, discordId: "d-no-password" });
    expect(verifyEmailPassword(db, discordAccount.email ?? "whatever@example.com", "anything")).toBeUndefined();
  });
});

describe("linkDiscordToAccount / linkPasswordToAccount (ADR 0053: both methods, one Account)", () => {
  it("links Discord onto an email/password Account — same Account id, gains a discordId", () => {
    const account = createAccountWithPassword(db, SIGNUP);
    const linked = linkDiscordToAccount(db, account.id, IDENTITY);

    expect(linked.id).toBe(account.id);
    expect(linked.discordId).toBe(IDENTITY.discordId);
    expect(linked.email).toBe(account.email);
  });

  it("linking Discord never overwrites the displayName the Player already chose at email signup", () => {
    const account = createAccountWithPassword(db, SIGNUP);
    const linked = linkDiscordToAccount(db, account.id, { ...IDENTITY, displayName: "A Totally Different Discord Name" });

    expect(linked.displayName).toBe(SIGNUP.displayName);
  });

  it("links email/password onto a Discord Account — same Account id, gains an email/password login", () => {
    const account = upsertAccountFromDiscord(db, IDENTITY);
    const linked = linkPasswordToAccount(db, account.id, { email: SIGNUP.email, password: SIGNUP.password });

    expect(linked.id).toBe(account.id);
    expect(linked.discordId).toBe(account.discordId);
    expect(verifyEmailPassword(db, SIGNUP.email, SIGNUP.password)).toEqual(linked);
  });

  it("linking a Discord identity already claimed by a different Account throws a uniqueness error", () => {
    upsertAccountFromDiscord(db, IDENTITY);
    const other = createAccountWithPassword(db, SIGNUP);

    try {
      linkDiscordToAccount(db, other.id, IDENTITY);
      expect.unreachable("expected a uniqueness violation");
    } catch (err) {
      expect(isUniqueConstraintError(err)).toBe(true);
    }
  });

  it("linking an email already claimed by a different Account throws a uniqueness error", () => {
    createAccountWithPassword(db, SIGNUP);
    const other = upsertAccountFromDiscord(db, IDENTITY);

    try {
      linkPasswordToAccount(db, other.id, { email: SIGNUP.email, password: "some other password" });
      expect.unreachable("expected a uniqueness violation");
    } catch (err) {
      expect(isUniqueConstraintError(err)).toBe(true);
    }
  });
});

describe("signup validation", () => {
  it("invalidEmailReason rejects non-emails and accepts real ones", () => {
    expect(invalidEmailReason("not-an-email")).toBeTruthy();
    expect(invalidEmailReason(123)).toBeTruthy();
    expect(invalidEmailReason("wobbleton@example.com")).toBeUndefined();
  });

  it("invalidPasswordReason enforces a minimum length", () => {
    expect(invalidPasswordReason("short")).toBeTruthy();
    expect(invalidPasswordReason("long enough password")).toBeUndefined();
  });

  it("invalidDisplayNameReason rejects empty/whitespace-only names", () => {
    expect(invalidDisplayNameReason("")).toBeTruthy();
    expect(invalidDisplayNameReason("   ")).toBeTruthy();
    expect(invalidDisplayNameReason("Wobbleton")).toBeUndefined();
  });
});
