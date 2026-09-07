import { describe, expect, it } from "vitest";
import { DEFAULT_SURVIVOR_TARGET, DEFAULT_TIME_LIMIT_MS } from "../tuning.js";
import { DEFAULT_ROUND_RULES, resolveRoundRules, type RoundRules } from "./RoundRules.js";

const trackDefaults = (
  timeLimitMs = 120_000,
  fallBehavior: RoundRules["fallBehavior"] = "respawn",
  survivorTarget = DEFAULT_SURVIVOR_TARGET,
): RoundRules => ({
  timeLimitMs,
  fallBehavior,
  survivorTarget,
});

describe("resolveRoundRules — Track defaults under Round overrides (ADR 0041)", () => {
  it("resolves to exactly the Track's own defaults when the Round supplies no overrides", () => {
    expect(resolveRoundRules(trackDefaults(90_000))).toEqual({
      timeLimitMs: 90_000,
      fallBehavior: "respawn",
      survivorTarget: DEFAULT_SURVIVOR_TARGET,
    });
  });

  it("resolves to exactly the Track's own defaults when the Round's overrides object is empty", () => {
    expect(resolveRoundRules(trackDefaults(90_000), {})).toEqual({
      timeLimitMs: 90_000,
      fallBehavior: "respawn",
      survivorTarget: DEFAULT_SURVIVOR_TARGET,
    });
  });

  it("takes the Round's override over the Track's default when one is supplied", () => {
    expect(resolveRoundRules(trackDefaults(90_000), { timeLimitMs: 30_000 })).toEqual({
      timeLimitMs: 30_000,
      fallBehavior: "respawn",
      survivorTarget: DEFAULT_SURVIVOR_TARGET,
    });
  });

  it("falls through to the Track's default when the override is present but undefined — absent, not zero", () => {
    // The same "blank means unset, not the floor" discipline the Track
    // builder's own draft field already follows (parseDraftTimeLimitMs).
    expect(resolveRoundRules(trackDefaults(90_000), { timeLimitMs: undefined })).toEqual({
      timeLimitMs: 90_000,
      fallBehavior: "respawn",
      survivorTarget: DEFAULT_SURVIVOR_TARGET,
    });
  });

  it("is a pure function — the same inputs always resolve to the same rules, no hidden state", () => {
    const defaults = trackDefaults(60_000);
    expect(resolveRoundRules(defaults, { timeLimitMs: 15_000 })).toEqual(resolveRoundRules(defaults, { timeLimitMs: 15_000 }));
  });

  it("resolves fallBehavior independently of timeLimitMs — each field falls through on its own", () => {
    expect(resolveRoundRules(trackDefaults(90_000, "respawn"), { timeLimitMs: 30_000 })).toEqual({
      timeLimitMs: 30_000,
      fallBehavior: "respawn",
      survivorTarget: DEFAULT_SURVIVOR_TARGET,
    });
  });

  it("takes a Round's fallBehavior override — a Round type is the caller choosing which override to pass, ADR 0042", () => {
    expect(resolveRoundRules(trackDefaults(), { fallBehavior: "eliminate" })).toEqual({
      timeLimitMs: 120_000,
      fallBehavior: "eliminate",
      survivorTarget: DEFAULT_SURVIVOR_TARGET,
    });
  });

  it("falls through to the Track default (always \"respawn\" — no Track ever carries an opinion, ADR 0041) when fallBehavior is absent", () => {
    expect(resolveRoundRules(trackDefaults(), { fallBehavior: undefined })).toEqual({
      timeLimitMs: 120_000,
      fallBehavior: "respawn",
      survivorTarget: DEFAULT_SURVIVOR_TARGET,
    });
  });

  it("takes a Round's own survivorTarget override — a real Track default under a real Round override, ADR 0041's own example", () => {
    expect(resolveRoundRules(trackDefaults(120_000, "eliminate", 4), { survivorTarget: 2 })).toEqual({
      timeLimitMs: 120_000,
      fallBehavior: "eliminate",
      survivorTarget: 2,
    });
  });

  it("falls through to the Track's own survivorTarget default when the Round supplies none", () => {
    expect(resolveRoundRules(trackDefaults(120_000, "eliminate", 4))).toEqual({
      timeLimitMs: 120_000,
      fallBehavior: "eliminate",
      survivorTarget: 4,
    });
  });

  it("falls through to the Track's survivorTarget when the override is present but undefined — absent, not zero", () => {
    expect(resolveRoundRules(trackDefaults(120_000, "eliminate", 4), { survivorTarget: undefined })).toEqual({
      timeLimitMs: 120_000,
      fallBehavior: "eliminate",
      survivorTarget: 4,
    });
  });
});

describe("DEFAULT_ROUND_RULES", () => {
  it("is a Race on a Track authored with no other opinion — the shared Time Limit default, and Falls respawn", () => {
    expect(DEFAULT_ROUND_RULES).toEqual({
      timeLimitMs: DEFAULT_TIME_LIMIT_MS,
      fallBehavior: "respawn",
      survivorTarget: DEFAULT_SURVIVOR_TARGET,
    });
  });
});
