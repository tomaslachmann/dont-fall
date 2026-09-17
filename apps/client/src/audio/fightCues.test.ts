import { HIT_CHARGE_MAX_MS, hitImpactMagnitude, IMPACT_RAGDOLL_MIN, type Vec3 } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import {
  CAUSED_STATE_WINDOW_MS,
  FightCues,
  HIT_PAIR_REACH,
  HIT_PAIR_WINDOW_MS,
  isHeavyHit,
  KNOCKDOWN_REFIRE_MIN_MS,
  SWING_REFIRE_MIN_MS,
  type FightFrame,
} from "./fightCues.js";

const AT: Vec3 = { x: 0, y: 1, z: 0 };

const frame = (nowMs: number, over: Partial<Omit<FightFrame, "nowMs">> = {}): FightFrame => ({
  position: AT,
  motionState: "Controlled",
  hitEpoch: 0,
  hitChargeMs: 0,
  hitReactEpoch: 0,
  grabEpoch: 0,
  grabbingId: null,
  ragdollEpoch: 0,
  ragdollCause: "Fall",
  respawned: false,
  ...over,
  nowMs,
});

describe("FightCues (M14 ticket 06)", () => {
  describe("swing", () => {
    it("fires once per rise, at the last charge held before it", () => {
      const cues = new FightCues();
      cues.update("a", frame(0));
      cues.update("a", frame(100, { hitChargeMs: 200 }));
      cues.update("a", frame(200, { hitChargeMs: 300 }));
      expect(cues.update("a", frame(233, { hitEpoch: 1 })).swing).toEqual({ charge: 300 / HIT_CHARGE_MAX_MS });
      expect(cues.update("a", frame(266, { hitEpoch: 1 })).swing).toBeNull();
    });

    it("forgets a charge lost to a Stagger, and a tap swings at nothing held", () => {
      const cues = new FightCues();
      cues.update("a", frame(0));
      cues.update("a", frame(100, { hitChargeMs: 500 }));
      cues.update("a", frame(133, { motionState: "Stagger" }));
      cues.update("a", frame(1000));
      expect(cues.update("a", frame(1033, { hitEpoch: 1 })).swing).toEqual({ charge: 0 });
    });

    it("is not a replay raising the Epoch again", () => {
      const cues = new FightCues();
      cues.update("a", frame(0));
      expect(cues.update("a", frame(16, { hitEpoch: 1 })).swing).not.toBeNull();
      expect(cues.update("a", frame(100, { hitEpoch: 2 })).swing).toBeNull();
      expect(cues.update("a", frame(16 + SWING_REFIRE_MIN_MS + 1, { hitEpoch: 3 })).swing).not.toBeNull();
    });
  });

  describe("a landed Hit", () => {
    it("takes the charge of the latest nearby swing by someone else, once", () => {
      const cues = new FightCues();
      const striker = { x: 1, y: 1, z: 0 };
      cues.update("a", frame(0, { position: striker }));
      cues.update("v", frame(0));
      cues.update("a", frame(50, { position: striker, hitChargeMs: HIT_CHARGE_MAX_MS }));
      cues.update("a", frame(100, { position: striker, hitEpoch: 1 }));
      expect(cues.update("v", frame(100, { hitReactEpoch: 1 })).struck).toBe(true);
      expect(cues.chargeOfHitOn("v", AT, 100)).toBe(1);
      expect(cues.chargeOfHitOn("v", AT, 100)).toBeNull();
    });

    it("never pairs with the victim's own swing, a far one, or a stale one", () => {
      const cues = new FightCues();
      cues.update("v", frame(0));
      cues.update("far", frame(0, { position: { x: HIT_PAIR_REACH + 1, y: 1, z: 0 } }));
      cues.update("old", frame(0));
      cues.update("old", frame(10, { hitEpoch: 1 }));
      cues.update("v", frame(20, { hitEpoch: 1 }));
      cues.update("far", frame(20, { position: { x: HIT_PAIR_REACH + 1, y: 1, z: 0 }, hitEpoch: 1 }));
      expect(cues.chargeOfHitOn("v", AT, 10 + HIT_PAIR_WINDOW_MS + 1)).toBeNull();
    });

    it("is heavy exactly when the simulation would knock down with it", () => {
      expect(isHeavyHit(0)).toBe(false);
      expect(isHeavyHit(1)).toBe(true);
      const threshold = [...Array(101).keys()].map((i) => i / 100).find((charge) => hitImpactMagnitude(charge) >= IMPACT_RAGDOLL_MIN)!;
      expect(isHeavyHit(threshold)).toBe(true);
      expect(isHeavyHit(threshold - 0.01)).toBe(false);
    });
  });

  describe("knockdown", () => {
    it("takes its weight from the cause when the Epoch rose with it", () => {
      const cues = new FightCues();
      cues.update("a", frame(0));
      expect(cues.update("a", frame(16, { motionState: "Ragdoll", ragdollEpoch: 1, ragdollCause: "WallImpact" })).knockdown).toEqual({
        weight: "heavy",
      });
      cues.update("a", frame(1000, { motionState: "GettingUp", ragdollEpoch: 1 }));
      cues.update("a", frame(2000, { ragdollEpoch: 1 }));
      const bump = cues.update("a", frame(3000, { motionState: "Ragdoll", ragdollEpoch: 2, ragdollCause: "Bump" }));
      expect(bump.knockdown).toEqual({ weight: "medium" });
      expect(bump.bumped).toBe(true);
    });

    it("is medium when a reconciliation forced it without an Epoch, and a Hit before it is no Bump", () => {
      const cues = new FightCues();
      cues.update("a", frame(0, { ragdollEpoch: 3, ragdollCause: "Spinner" }));
      cues.update("a", frame(16, { ragdollEpoch: 3, ragdollCause: "Spinner", hitReactEpoch: 1 }));
      const forced = cues.update("a", frame(50, { motionState: "Ragdoll", ragdollEpoch: 3, ragdollCause: "Spinner", hitReactEpoch: 1 }));
      expect(forced.knockdown).toEqual({ weight: "medium" });
      expect(forced.bumped).toBe(false);
    });

    it("is one knockdown when a mispredicted one is undone and confirmed", () => {
      const cues = new FightCues();
      cues.update("a", frame(0));
      expect(cues.update("a", frame(16, { motionState: "Ragdoll", ragdollEpoch: 1, ragdollCause: "Spinner" })).knockdown).not.toBeNull();
      cues.update("a", frame(100, { ragdollEpoch: 1 }));
      expect(cues.update("a", frame(200, { motionState: "Ragdoll", ragdollEpoch: 2, ragdollCause: "Spinner" })).knockdown).toBeNull();
      cues.update("a", frame(300, { ragdollEpoch: 2 }));
      expect(
        cues.update("a", frame(16 + KNOCKDOWN_REFIRE_MIN_MS, { motionState: "Ragdoll", ragdollEpoch: 3, ragdollCause: "Spinner" })).knockdown,
      ).not.toBeNull();
    });

    it("gets up once, on entering GettingUp", () => {
      const cues = new FightCues();
      cues.update("a", frame(0, { motionState: "Ragdoll" }));
      expect(cues.update("a", frame(16, { motionState: "GettingUp" })).gettingUp).toBe(true);
      expect(cues.update("a", frame(33, { motionState: "GettingUp" })).gettingUp).toBe(false);
    });
  });

  describe("bump", () => {
    it("is a Stagger nothing else explains, once per wobble", () => {
      const cues = new FightCues();
      cues.update("a", frame(0));
      expect(cues.update("a", frame(16, { motionState: "Stagger" })).bumped).toBe(true);
      cues.update("a", frame(100));
      expect(cues.update("a", frame(150, { motionState: "Stagger" })).bumped).toBe(false);
    });

    it("is not the Stagger a Respawn or a Hit brings, inside their window", () => {
      const cues = new FightCues();
      cues.update("a", frame(0));
      cues.update("a", frame(1000, { respawned: true }));
      expect(cues.update("a", frame(1033, { motionState: "Stagger" })).bumped).toBe(false);
      cues.update("a", frame(3000));
      cues.update("a", frame(4000, { hitReactEpoch: 1 }));
      expect(cues.update("a", frame(4000 + CAUSED_STATE_WINDOW_MS, { hitReactEpoch: 1, motionState: "Stagger" })).bumped).toBe(false);
    });
  });

  describe("grab", () => {
    it("reaches on the Epoch and grips when a hold starts, each once", () => {
      const cues = new FightCues();
      cues.update("a", frame(0));
      expect(cues.update("a", frame(16, { grabEpoch: 1 })).reached).toBe(true);
      const gripped = cues.update("a", frame(33, { grabEpoch: 1, grabbingId: "b" }));
      expect(gripped).toMatchObject({ reached: false, gripped: true });
      expect(cues.update("a", frame(50, { grabEpoch: 1, grabbingId: "b" })).gripped).toBe(false);
    });

    it("is no grip for a hold already going when first seen", () => {
      const cues = new FightCues();
      expect(cues.update("a", frame(0, { grabbingId: "b" })).gripped).toBe(false);
    });
  });

  it("takes the first sight as history, and forgets an id entirely", () => {
    const cues = new FightCues();
    const first = cues.update("a", frame(0, { hitEpoch: 4, hitReactEpoch: 2, motionState: "Ragdoll", ragdollEpoch: 3 }));
    expect(first).toMatchObject({ swing: null, struck: false, knockdown: null });
    cues.update("a", frame(16, { hitEpoch: 4, hitReactEpoch: 2, ragdollEpoch: 3 }));
    cues.forget("a");
    expect(cues.update("a", frame(1000, { hitEpoch: 5, hitReactEpoch: 3 })).struck).toBe(false);
  });
});
