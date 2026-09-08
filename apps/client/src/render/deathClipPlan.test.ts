import { describe, expect, it } from "vitest";
import { planDeathClip } from "./deathClipPlan.js";

describe("planDeathClip", () => {
  it("collapses on entering Ragdoll from Controlled, on an already-tracked rig", () => {
    expect(planDeathClip("Ragdoll", "Controlled", false, false)).toEqual({ kind: "collapse" });
  });

  it("collapses on entering Ragdoll from Stagger too", () => {
    expect(planDeathClip("Ragdoll", "Stagger", false, false)).toEqual({ kind: "collapse" });
  });

  it(
    "regression (code review, M6 ticket 02): a rig's very first observation of its Character already being " +
      "Ragdoll must snap straight to the collapsed end pose, not play the fall animation from frame 0 on an " +
      "already-downed body",
    () => {
      expect(planDeathClip("Ragdoll", "Controlled", true, false)).toEqual({ kind: "snapDown" });
    },
  );

  it("resumes the reverse play on entering GettingUp after this rig actually played the collapse", () => {
    expect(planDeathClip("GettingUp", "Ragdoll", false, true)).toEqual({ kind: "resumeReverse" });
  });

  it(
    "regression (code review, M6 ticket 02): a rig whose very first observation of this Character is already " +
      "GettingUp — joined mid-animation, or rebuilt after a fresh connection — never actually played the " +
      "collapse, so it must start the reverse play cold rather than silently doing nothing",
    () => {
      expect(planDeathClip("GettingUp", "Controlled", false, false)).toEqual({ kind: "coldReverse" });
    },
  );

  it("also treats a first-ever observation of Stagger-then-GettingUp as cold — everEnteredRagdoll is what matters, not the prior state's name", () => {
    expect(planDeathClip("GettingUp", "Stagger", false, false)).toEqual({ kind: "coldReverse" });
  });

  it("a snapDown counts as having entered Ragdoll — a later real GettingUp resumes normally, not cold", () => {
    // The caller is expected to set everEnteredRagdoll = true after a snapDown,
    // exactly like after a real collapse — this pins that contract.
    expect(planDeathClip("GettingUp", "Ragdoll", false, true)).toEqual({ kind: "resumeReverse" });
  });

  it("resumes locomotion on leaving a down state back to Controlled", () => {
    expect(planDeathClip("Controlled", "GettingUp", false, true)).toEqual({ kind: "resume" });
  });

  it("resumes locomotion on a reconciliation snap straight from Ragdoll to Controlled, skipping GettingUp", () => {
    expect(planDeathClip("Controlled", "Ragdoll", false, true)).toEqual({ kind: "resume" });
  });

  it("does nothing while continuing in an ordinary Controlled/Stagger tick", () => {
    expect(planDeathClip("Controlled", "Controlled", false, false)).toEqual({ kind: "none" });
    expect(planDeathClip("Stagger", "Controlled", false, false)).toEqual({ kind: "none" });
  });

  it("does nothing while Ragdoll or GettingUp simply continues, tick over tick", () => {
    expect(planDeathClip("Ragdoll", "Ragdoll", false, true)).toEqual({ kind: "none" });
    expect(planDeathClip("GettingUp", "GettingUp", false, true)).toEqual({ kind: "none" });
  });
});
