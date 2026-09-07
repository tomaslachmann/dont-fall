import { describe, expect, it } from "vitest";
import { RECONCILE_POSITION_EPSILON } from "../tuning.js";
import type { CharacterMotionState } from "./CharacterStateMachine.js";
import { needsCorrection } from "./reconcileGate.js";

const at = (motionState: CharacterMotionState, finishTick: number | null = null) => ({ motionState, finishTick });
const CONTROLLED = at("Controlled");

describe("needsCorrection", () => {
  it("ignores float-noise position drift while everything else agrees", () => {
    expect(needsCorrection(CONTROLLED, CONTROLLED, RECONCILE_POSITION_EPSILON / 2)).toBe(false);
  });

  it("corrects once the position disagreement is real", () => {
    expect(needsCorrection(CONTROLLED, CONTROLLED, RECONCILE_POSITION_EPSILON * 2)).toBe(true);
  });

  it("always syncs a server-reported knockdown — only the server starts one", () => {
    expect(needsCorrection(at("Ragdoll"), CONTROLLED, 0)).toBe(true);
  });

  it("always syncs when we think we are down and the server does not — only the server ends one", () => {
    expect(needsCorrection(CONTROLLED, at("GettingUp"), 0)).toBe(true);
  });

  it("corrects a motionState disagreement even where the positions match", () => {
    expect(needsCorrection(at("Stagger"), CONTROLLED, 0)).toBe(true);
  });

  it("corrects when we predicted a Qualification the server did not give us", () => {
    // The case that matters most: a wrongly-predicted Qualification locks our
    // own input, so both sides come to rest and the positions then agree to
    // well inside the epsilon. Without this the gate never opens again and the
    // player is stuck locked and falsely Qualified for the rest of the Round.
    expect(needsCorrection(at("Controlled", null), at("Controlled", 500), 0)).toBe(true);
  });

  it("corrects when the server Qualified us and we have not noticed", () => {
    expect(needsCorrection(at("Controlled", 500), at("Controlled", null), 0)).toBe(true);
  });

  it("corrects when both agree we Qualified but disagree on the Tick", () => {
    expect(needsCorrection(at("Controlled", 500), at("Controlled", 502), 0)).toBe(true);
  });

  it("settles once the two agree on the Qualification Tick", () => {
    expect(needsCorrection(at("Controlled", 500), at("Controlled", 500), 0)).toBe(false);
  });

  it("corrects when there is no baseline to compare against (an infinite error)", () => {
    expect(needsCorrection(CONTROLLED, CONTROLLED, Infinity)).toBe(true);
  });
});
