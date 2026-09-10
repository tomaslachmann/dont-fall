import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** scrypt's output length in bytes — arbitrary but fixed, so `verifyPassword` can compare fixed-length buffers. */
const KEY_LENGTH = 64;

/**
 * Hashes `password` with a fresh random salt — `node:crypto`'s `scrypt` (a
 * memory-hard KDF, no new dependency, consistent with this codebase already
 * using `node:crypto` for content hashing and bearer tokens). Stored as
 * `"<salt-hex>:<hash-hex>"` in `accounts.passwordHash`.
 */
export const hashPassword = (password: string): string => {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `${salt}:${hash}`;
};

/**
 * Verifies `password` against a `hashPassword` output. Timing-safe compare —
 * never a plain `===`/`Buffer.equals` on the hash, which would leak how many
 * leading bytes matched through response timing.
 */
export const verifyPassword = (password: string, stored: string): boolean => {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const candidate = scryptSync(password, salt, KEY_LENGTH);
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
};
