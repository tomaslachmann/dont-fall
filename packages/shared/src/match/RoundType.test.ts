import { describe, expect, it } from "vitest";
import { DEFAULT_ROUND_RULES, resolveRoundRules } from "./RoundRules.js";
import { DEFAULT_ROUND_TYPE, ROUND_TYPES, roundStartBlockedReason, roundTypeLabel, roundTypeOverrides } from "./RoundType.js";

describe("roundTypeOverrides", () => {
  it("makes Survival eliminate on a Fall", () => {
    expect(roundTypeOverrides("survival").fallBehavior).toBe("eliminate");
  });

  it("makes a Race respawn on a Fall", () => {
    expect(roundTypeOverrides("race").fallBehavior).toBe("respawn");
  });

  it("never overrides the Survivor Target, so Survival runs on the Track's authored one", () => {
    const trackDefaults = { ...DEFAULT_ROUND_RULES, survivorTarget: 4, timeLimitMs: 90_000 };
    const rules = resolveRoundRules(trackDefaults, roundTypeOverrides("survival"));
    expect(rules.survivorTarget).toBe(4);
    expect(rules.timeLimitMs).toBe(90_000);
    expect(rules.fallBehavior).toBe("eliminate");
  });

  it("leaves a Race on the Track's own defaults apart from its Fall rule", () => {
    const trackDefaults = { ...DEFAULT_ROUND_RULES, survivorTarget: 4, timeLimitMs: 90_000 };
    expect(resolveRoundRules(trackDefaults, roundTypeOverrides("race"))).toEqual({
      timeLimitMs: 90_000,
      fallBehavior: "respawn",
      survivorTarget: 4,
    });
  });
});

describe("roundStartBlockedReason", () => {
  it("refuses a Race on a Track with no Finish Zone, with a readable reason", () => {
    const reason = roundStartBlockedReason("race", false);
    expect(reason).toContain("Finish Zone");
    expect(reason).toContain("Survival");
  });

  it("allows a Race on a Track that has one", () => {
    expect(roundStartBlockedReason("race", true)).toBeUndefined();
  });

  it("allows Survival either way — it never reads a Finish Zone", () => {
    expect(roundStartBlockedReason("survival", false)).toBeUndefined();
    expect(roundStartBlockedReason("survival", true)).toBeUndefined();
  });
});

describe("the Round types a Lobby offers", () => {
  it("starts on a Race, so a Lobby that never touches the picker behaves as it always did", () => {
    expect(DEFAULT_ROUND_TYPE).toBe("race");
    expect(ROUND_TYPES).toContain(DEFAULT_ROUND_TYPE);
  });

  it("has a display name for every one of them", () => {
    expect(ROUND_TYPES.map(roundTypeLabel)).toEqual(["Race", "Survival"]);
  });
});
