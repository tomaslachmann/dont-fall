import { randomUUID } from "node:crypto";

/**
 * One live Lobby the broker knows about (grilling session, 2026-09) — the
 * bookkeeping half only. Owns no I/O and no `MatchServer` instance itself
 * (that lives in `index.ts`, which is what can actually start/stop one);
 * this stays a pure, synchronously-testable map so the id/code allocation
 * rules have nothing to do with the real network to get right.
 */
export interface LobbyEntry {
  id: string;
  /** 6-char join code, generated only for a private Lobby — `undefined` for a public one, which is found by browsing/quick-match instead. */
  code: string | undefined;
  isPrivate: boolean;
  port: number;
  createdAt: number;
  /**
   * The last time this Lobby's own `/status` reported at least one
   * connected Player — `createdAt` until the first such poll. What the idle
   * reaper (`index.ts`) measures a grace period from: a Lobby nobody has
   * ever joined, or one that emptied back out, both look identical from
   * here — "no one has been here for a while" is the only thing that
   * matters for reaping it.
   */
  lastNonEmptyAt: number;
}

const CODE_LENGTH = 6;
// Excludes 0/O and 1/I — a human reading this code off a friend's screen
// (or a voice call) is the entire point of it; ambiguous glyphs defeat that.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const generateCode = (): string =>
  Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");

/**
 * The broker's in-memory registry — every Lobby it has spun up and not yet
 * torn down. In-memory only, on purpose (this project's own established
 * pattern: don't build for scale/durability this doesn't need yet) — a
 * broker restart loses the registry, but every `MatchServer` it was tracking
 * dies with the same process anyway (they're in-process instances, not
 * separate OS processes), so there is nothing to reconnect to regardless.
 */
export class LobbyRegistry {
  private readonly byId = new Map<string, LobbyEntry>();
  private readonly byCode = new Map<string, string>(); // code -> id

  /** Registers a new Lobby, generating a unique join code only if `isPrivate`. Returns the entry so the caller can read the code/id back. */
  add(port: number, isPrivate: boolean): LobbyEntry {
    const id = randomUUID();
    let code: string | undefined;
    if (isPrivate) {
      do {
        code = generateCode();
      } while (this.byCode.has(code));
    }
    const now = Date.now();
    const entry: LobbyEntry = { id, code, isPrivate, port, createdAt: now, lastNonEmptyAt: now };
    this.byId.set(id, entry);
    if (code) this.byCode.set(code, id);
    return entry;
  }

  get(id: string): LobbyEntry | undefined {
    return this.byId.get(id);
  }

  getByCode(code: string): LobbyEntry | undefined {
    const id = this.byCode.get(code.toUpperCase());
    return id ? this.byId.get(id) : undefined;
  }

  /** Every currently-tracked public Lobby — the quick-match/browse candidate pool. Live occupancy/phase is not this registry's business; the caller polls `/status` for that. */
  listPublic(): LobbyEntry[] {
    return [...this.byId.values()].filter((entry) => !entry.isPrivate);
  }

  /** Removes a Lobby from the registry (its `MatchServer` is the caller's own to close first). A no-op for an unknown id — never an error, matching this project's other "closing/removing an already-gone thing" idioms. */
  remove(id: string): void {
    const entry = this.byId.get(id);
    if (!entry) return;
    this.byId.delete(id);
    if (entry.code) this.byCode.delete(entry.code);
  }

  all(): LobbyEntry[] {
    return [...this.byId.values()];
  }

  /** Records that `id`'s last `/status` poll saw at least one connected Player — resets the idle-reap clock. A no-op for an unknown id. */
  touch(id: string, now = Date.now()): void {
    const entry = this.byId.get(id);
    if (entry) entry.lastNonEmptyAt = now;
  }
}
