import { DEFAULT_TIME_LIMIT_MS, MAX_TIME_LIMIT_MS, MIN_TIME_LIMIT_MS } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { parseDraftTimeLimitMs } from "./timeLimitField.js";

describe("parseDraftTimeLimitMs", () => {
  it("reads whole seconds as milliseconds", () => {
    expect(parseDraftTimeLimitMs("90")).toBe(90_000);
    expect(parseDraftTimeLimitMs("45.5")).toBe(45_500);
  });

  it("falls back to the default for an empty field", () => {
    // A Revision is immutable (ADR 0032), so an emptied field must not
    // silently publish a permanent 10-second Round via the lower bound.
    expect(parseDraftTimeLimitMs("")).toBe(DEFAULT_TIME_LIMIT_MS);
    expect(parseDraftTimeLimitMs("   ")).toBe(DEFAULT_TIME_LIMIT_MS);
  });

  it("falls back to the default for something that isn't a number at all", () => {
    expect(parseDraftTimeLimitMs("abc")).toBe(DEFAULT_TIME_LIMIT_MS);
    expect(parseDraftTimeLimitMs("Infinity")).toBe(DEFAULT_TIME_LIMIT_MS);
  });

  it("clamps a real but out-of-range number to what track-service will accept", () => {
    // A genuine typed value is clamped rather than discarded: the author meant
    // *something*, and the nearest legal clock beats a rejected publish.
    expect(parseDraftTimeLimitMs("1")).toBe(MIN_TIME_LIMIT_MS);
    expect(parseDraftTimeLimitMs("0")).toBe(MIN_TIME_LIMIT_MS);
    expect(parseDraftTimeLimitMs("-30")).toBe(MIN_TIME_LIMIT_MS);
    expect(parseDraftTimeLimitMs("99999")).toBe(MAX_TIME_LIMIT_MS);
  });

  it("passes the exact bounds through untouched", () => {
    expect(parseDraftTimeLimitMs(String(MIN_TIME_LIMIT_MS / 1000))).toBe(MIN_TIME_LIMIT_MS);
    expect(parseDraftTimeLimitMs(String(MAX_TIME_LIMIT_MS / 1000))).toBe(MAX_TIME_LIMIT_MS);
  });

  it("produces a whole number of milliseconds, which is what the Revision stores", () => {
    expect(Number.isInteger(parseDraftTimeLimitMs("45.0004"))).toBe(true);
  });
});
