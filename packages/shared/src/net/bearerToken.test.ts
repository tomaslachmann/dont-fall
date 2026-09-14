import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { randomBearerToken } from "./bearerToken.js";

describe("randomBearerToken", () => {
  it("defaults to a 32-byte token, base64url-encoded (43 chars, no padding)", () => {
    const token = randomBearerToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("respects an explicit byte length (16 bytes -> 22 chars)", () => {
    const token = randomBearerToken(16);
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("never contains standard base64's +, /, or = — this is the URL/cookie-safe alphabet", () => {
    for (let i = 0; i < 50; i++) {
      expect(randomBearerToken()).not.toMatch(/[+/=]/);
    }
  });

  it("two calls produce different tokens (real randomness, not a fixed string)", () => {
    expect(randomBearerToken()).not.toBe(randomBearerToken());
  });

  it("never imports node:crypto — this file runs in the browser too (packages/shared), where Vite externalizes it and crashes on first access", () => {
    const source = readFileSync(fileURLToPath(new URL("./bearerToken.ts", import.meta.url)), "utf8");
    // Matches an actual import/require, not this file's own explanatory comments about why it avoids one.
    expect(source).not.toMatch(/from\s+["']node:crypto["']|require\(["']node:crypto["']\)/);
  });
});
