import { DEFAULT_TIME_LIMIT_MS } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { formatRaceClock, formatRaceTime, formatRoundClock, formatSplit, formatSurvived } from "./roundTimer.js";

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

describe("formatRaceTime", () => {
  it("renders a finished run as mm:ss.mmm, floored", () => {
    expect(formatRaceTime(82_104)).toBe("01:22.104");
    expect(formatRaceTime(82_104.9)).toBe("01:22.104");
    expect(formatRaceTime(0)).toBe("00:00.000");
  });

  it("never credits time never run", () => {
    expect(formatRaceTime(-50)).toBe("00:00.000");
  });
});

describe("formatSurvived", () => {
  it("renders whole seconds survived as m:ss, floored", () => {
    expect(formatSurvived(272_000)).toBe("4:32");
    expect(formatSurvived(272_999)).toBe("4:32");
    expect(formatSurvived(9_000)).toBe("0:09");
  });
});

describe("formatRaceClock", () => {
  it("splits a running clock into mm:ss and a floored tenths tail", () => {
    expect(formatRaceClock(84_382)).toEqual({ time: "01:24", tenths: ".3" });
    expect(formatRaceClock(84_399.9)).toEqual({ time: "01:24", tenths: ".3" });
    expect(formatRaceClock(0)).toEqual({ time: "00:00", tenths: ".0" });
    expect(formatRaceClock(-10)).toEqual({ time: "00:00", tenths: ".0" });
  });
});

describe("formatSplit", () => {
  it("signs a split: plus behind, a true minus ahead, plus when level", () => {
    expect(formatSplit(2478)).toBe("+2.478");
    expect(formatSplit(-1034)).toBe("\u22121.034");
    expect(formatSplit(0)).toBe("+0.000");
    expect(formatSplit(61_005)).toBe("+61.005");
  });
});
