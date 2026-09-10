import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("hashPassword / verifyPassword", () => {
  it("verifies the correct password", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects a wrong password", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(verifyPassword("wrong password", stored)).toBe(false);
  });

  it("never stores the password in plaintext", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(stored).not.toContain("correct horse battery staple");
  });

  it("two hashes of the same password differ (random salt)", () => {
    const a = hashPassword("same password");
    const b = hashPassword("same password");
    expect(a).not.toBe(b);
    expect(verifyPassword("same password", a)).toBe(true);
    expect(verifyPassword("same password", b)).toBe(true);
  });

  it("a malformed stored value (no salt separator) fails closed, not throws", () => {
    expect(verifyPassword("anything", "not-a-real-stored-hash")).toBe(false);
  });
});
