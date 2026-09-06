import { DEFAULT_TIME_LIMIT_MS } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { formatRoundClock } from "./roundTimer.js";

describe("formatRoundClock", () => {
  it("shows the authored Time Limit whole at the start of a Round", () => {
    expect(formatRoundClock(DEFAULT_TIME_LIMIT_MS)).toBe("3:00");
    expect(formatRoundClock(45_000)).toBe("0:45");
  });

  it("pads the seconds to two digits", () => {
    expect(formatRoundClock(61_000)).toBe("1:01");
    expect(formatRoundClock(9_000)).toBe("0:09");
  });

  it("rounds up, so a Round shows its full clock until a whole second has gone", () => {
    // A countdown that read 2:59 the instant it started would look broken.
    expect(formatRoundClock(DEFAULT_TIME_LIMIT_MS - 1)).toBe("3:00");
    expect(formatRoundClock(44_001)).toBe("0:45");
  });

  it("reaches 0:00 only when the clock is genuinely out", () => {
    expect(formatRoundClock(1)).toBe("0:01");
    expect(formatRoundClock(0)).toBe("0:00");
  });

  it("does not go negative — the server holds at zero and keeps ticking (M4 ticket 05 ends the Round)", () => {
    expect(formatRoundClock(-5_000)).toBe("0:00");
  });

  it("carries minutes past ten without truncating", () => {
    expect(formatRoundClock(600_000)).toBe("10:00");
  });
});
