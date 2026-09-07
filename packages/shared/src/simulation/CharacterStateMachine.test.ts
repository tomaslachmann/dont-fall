import { describe, expect, it } from "vitest";
import {
  GETUP_TICKS,
  IMPACT_RAGDOLL_MIN,
  IMPACT_STAGGER_MIN,
  RAGDOLL_MAX_TICKS,
  RAGDOLL_MIN_TICKS,
  SLIDE_INPUT_SCALE,
  STAGGER_INPUT_SCALE,
  STAGGER_TICKS,
} from "../tuning.js";
import { CharacterStateMachine, isDownMotionState, type CharacterMotionState } from "./CharacterStateMachine.js";

const run = (m: CharacterStateMachine, ticks: number, settled = false) => {
  for (let i = 0; i < ticks; i += 1) m.tick(settled);
};

describe("isDownMotionState", () => {
  it("is true for Ragdoll and GettingUp, false for every other motion state", () => {
    const down: CharacterMotionState[] = ["Ragdoll", "GettingUp"];
    const up: CharacterMotionState[] = ["Controlled", "Stagger", "Sliding"];

    for (const state of down) expect(isDownMotionState(state)).toBe(true);
    for (const state of up) expect(isDownMotionState(state)).toBe(false);
  });
});

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

  it("does not re-ragdoll from GettingUp (the recovery always completes)", () => {
    const m = new CharacterStateMachine();
    m.forceRagdoll();
    m.tick(false);
    run(m, RAGDOLL_MAX_TICKS + 2, false); // -> GettingUp
    expect(m.state).toBe("GettingUp");
    m.impact(IMPACT_RAGDOLL_MIN + 5);
    m.tick(false);
    expect(m.state).toBe("GettingUp"); // hit shrugged off — no interrupt
  });

  it("continuous hard Impacts can never soft-lock the Character out of Controlled", () => {
    const m = new CharacterStateMachine();
    m.forceRagdoll();
    let reachedControlled = false;
    for (let i = 0; i < RAGDOLL_MAX_TICKS + GETUP_TICKS + 10; i += 1) {
      m.impact(IMPACT_RAGDOLL_MIN + 3); // hit every single tick
      if (m.tick(false) === "Controlled") reachedControlled = true;
    }
    expect(reachedControlled).toBe(true);
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

describe("CharacterStateMachine — Sliding (ticket 03, M3.6, ADR 0037): a condition, not a timer", () => {
  it("enters Sliding while grounded on a too-steep Surface, with reduced input", () => {
    const m = new CharacterStateMachine();
    m.tick(false, true);
    expect(m.state).toBe("Sliding");
    expect(m.inputScale).toBe(SLIDE_INPUT_SCALE);
  });

  it("leaves Sliding the instant the condition no longer holds — no timer, no minimum duration", () => {
    const m = new CharacterStateMachine();
    m.tick(false, true);
    expect(m.state).toBe("Sliding");
    m.tick(false, false);
    expect(m.state).toBe("Controlled");
  });

  it("stays Sliding for as long as the condition holds, however many ticks", () => {
    const m = new CharacterStateMachine();
    for (let i = 0; i < 200; i += 1) m.tick(false, true);
    expect(m.state).toBe("Sliding");
  });

  it("a sub-threshold Impact while Sliding does not interrupt it", () => {
    const m = new CharacterStateMachine();
    m.tick(false, true);
    m.impact(IMPACT_STAGGER_MIN);
    m.tick(false, true);
    expect(m.state).toBe("Sliding");
  });

  it("a hard Impact while Sliding goes straight to Ragdoll, exactly as from Stagger", () => {
    const m = new CharacterStateMachine();
    m.tick(false, true);
    m.impact(IMPACT_RAGDOLL_MIN);
    m.tick(false, true);
    expect(m.state).toBe("Ragdoll");
  });

  it("a too-steep Surface takes priority over a merely-medium Impact from Controlled — sliding away matters more than a wobble in place", () => {
    const m = new CharacterStateMachine();
    m.impact((IMPACT_STAGGER_MIN + IMPACT_RAGDOLL_MIN) / 2);
    m.tick(false, true); // both conditions true on the same tick
    expect(m.state).toBe("Sliding");
  });

  it("does not enter Sliding while Staggering — the Stagger timer runs its course regardless of the slope condition", () => {
    const m = new CharacterStateMachine();
    m.impact((IMPACT_STAGGER_MIN + IMPACT_RAGDOLL_MIN) / 2);
    m.tick(false, false); // enters Stagger, not on a slope
    expect(m.state).toBe("Stagger");
    for (let i = 0; i < STAGGER_TICKS - 1; i += 1) m.tick(false, true); // now on a too-steep Surface, but still Staggering
    expect(m.state).toBe("Stagger");
  });

  it("reaches Sliding on the tick after Stagger recovers, if still on a too-steep Surface — one transition per tick, same as every other state (e.g. GettingUp -> Controlled)", () => {
    const m = new CharacterStateMachine();
    m.impact((IMPACT_STAGGER_MIN + IMPACT_RAGDOLL_MIN) / 2);
    m.tick(false, false); // enters Stagger, not on a slope
    expect(m.state).toBe("Stagger");
    for (let i = 0; i < STAGGER_TICKS - 1; i += 1) m.tick(false, true); // too-steep for the rest of the Stagger
    expect(m.state).toBe("Stagger"); // one tick before recovery
    m.tick(false, true); // recovers to Controlled this tick — the still-too-steep condition isn't re-checked until the next
    expect(m.state).toBe("Controlled");
    m.tick(false, true);
    expect(m.state).toBe("Sliding");
  });

  it("forceRagdoll overrides Sliding", () => {
    const m = new CharacterStateMachine();
    m.tick(false, true);
    expect(m.state).toBe("Sliding");
    m.forceRagdoll();
    m.tick(false, true);
    expect(m.state).toBe("Ragdoll");
  });
});
