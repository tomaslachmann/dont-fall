import { describe, expect, it } from "vitest";
import {
  GETUP_TICKS,
  IMPACT_RAGDOLL_MIN,
  IMPACT_STAGGER_MIN,
  RAGDOLL_MAX_TICKS,
  RAGDOLL_MIN_TICKS,
  STAGGER_INPUT_SCALE,
  STAGGER_TICKS,
} from "../tuning.js";
import { CharacterStateMachine } from "./CharacterStateMachine.js";

const run = (m: CharacterStateMachine, ticks: number, settled = false) => {
  for (let i = 0; i < ticks; i += 1) m.tick(settled);
};

describe("CharacterStateMachine", () => {
  it("starts Controlled with full input", () => {
    const m = new CharacterStateMachine();
    expect(m.state).toBe("Controlled");
    expect(m.inputScale).toBe(1);
  });

  it("ignores an Impact below the stagger threshold", () => {
    const m = new CharacterStateMachine();
    m.impact(IMPACT_STAGGER_MIN - 0.01);
    m.tick(false);
    expect(m.state).toBe("Controlled");
  });

  it("staggers on a medium Impact and recovers after STAGGER_TICKS", () => {
    const m = new CharacterStateMachine();
    m.impact((IMPACT_STAGGER_MIN + IMPACT_RAGDOLL_MIN) / 2);
    m.tick(false);
    expect(m.state).toBe("Stagger");
    expect(m.inputScale).toBe(STAGGER_INPUT_SCALE);

    run(m, STAGGER_TICKS);
    expect(m.state).toBe("Controlled");
  });

  it("ragdolls on a hard Impact and blocks input", () => {
    const m = new CharacterStateMachine();
    m.impact(IMPACT_RAGDOLL_MIN);
    m.tick(false);
    expect(m.state).toBe("Ragdoll");
    expect(m.inputScale).toBe(0);
  });

  it("stays in Ragdoll until it has both passed RAGDOLL_MIN_TICKS and settled", () => {
    const m = new CharacterStateMachine();
    m.impact(IMPACT_RAGDOLL_MIN);
    m.tick(false);

    run(m, RAGDOLL_MIN_TICKS - 2, true); // settled early, but min time not reached
    expect(m.state).toBe("Ragdoll");

    run(m, 5, false); // min time passed, but not settled
    expect(m.state).toBe("Ragdoll");

    m.tick(true); // settled and past the minimum
    expect(m.state).toBe("GettingUp");
  });

  it("forces GettingUp at RAGDOLL_MAX_TICKS even if never settled", () => {
    const m = new CharacterStateMachine();
    m.impact(IMPACT_RAGDOLL_MIN);
    m.tick(false);
    run(m, RAGDOLL_MAX_TICKS + 2, false);
    expect(m.state).toBe("GettingUp");
  });

  it("recovers Controlled after GettingUp completes, input blocked until then", () => {
    const m = new CharacterStateMachine();
    m.forceRagdoll();
    m.tick(false);
    run(m, RAGDOLL_MAX_TICKS + 2, false); // -> GettingUp
    expect(m.state).toBe("GettingUp");
    expect(m.inputScale).toBe(0);

    run(m, GETUP_TICKS);
    expect(m.state).toBe("Controlled");
    expect(m.inputScale).toBe(1);
  });

  it("forceRagdoll overrides any state", () => {
    const m = new CharacterStateMachine();
    m.impact((IMPACT_STAGGER_MIN + IMPACT_RAGDOLL_MIN) / 2);
    m.tick(false);
    expect(m.state).toBe("Stagger");
    m.forceRagdoll();
    m.tick(false);
    expect(m.state).toBe("Ragdoll");
  });

  it("re-ragdolls from GettingUp on a fresh hard Impact", () => {
    const m = new CharacterStateMachine();
    m.forceRagdoll();
    m.tick(false);
    run(m, RAGDOLL_MAX_TICKS + 2, false); // -> GettingUp
    m.impact(IMPACT_RAGDOLL_MIN);
    m.tick(false);
    expect(m.state).toBe("Ragdoll");
  });

  it("reset returns to Controlled", () => {
    const m = new CharacterStateMachine();
    m.forceRagdoll();
    m.tick(false);
    m.reset();
    expect(m.state).toBe("Controlled");
    expect(m.inputScale).toBe(1);
  });
});
