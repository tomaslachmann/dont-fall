import { describe, expect, it } from "vitest";
import { DEFAULT_TIME_LIMIT_MS } from "../tuning.js";
import { DEFAULT_ROUND_RULES, resolveRoundRules, type RoundRules } from "./RoundRules.js";

const trackDefaults = (timeLimitMs = 120_000): RoundRules => ({ timeLimitMs });

describe("resolveRoundRules — Track defaults under Round overrides (ADR 0041)", () => {
  it("resolves to exactly the Track's own defaults when the Round supplies no overrides", () => {
    expect(resolveRoundRules(trackDefaults(90_000))).toEqual({ timeLimitMs: 90_000 });
  });

  it("resolves to exactly the Track's own defaults when the Round's overrides object is empty", () => {
    expect(resolveRoundRules(trackDefaults(90_000), {})).toEqual({ timeLimitMs: 90_000 });
  });

  it("takes the Round's override over the Track's default when one is supplied", () => {
    expect(resolveRoundRules(trackDefaults(90_000), { timeLimitMs: 30_000 })).toEqual({ timeLimitMs: 30_000 });
  });

  it("falls through to the Track's default when the override is present but undefined — absent, not zero", () => {
    // The same "blank means unset, not the floor" discipline the Track
    // builder's own draft field already follows (parseDraftTimeLimitMs).
    expect(resolveRoundRules(trackDefaults(90_000), { timeLimitMs: undefined })).toEqual({ timeLimitMs: 90_000 });
  });

  it("is a pure function — the same inputs always resolve to the same rules, no hidden state", () => {
    const defaults = trackDefaults(60_000);
    expect(resolveRoundRules(defaults, { timeLimitMs: 15_000 })).toEqual(resolveRoundRules(defaults, { timeLimitMs: 15_000 }));
  });
});

describe("DEFAULT_ROUND_RULES", () => {
  it("is a Race on a Track authored with no other opinion — the shared Time Limit default", () => {
    expect(DEFAULT_ROUND_RULES).toEqual({ timeLimitMs: DEFAULT_TIME_LIMIT_MS });
  });
});
