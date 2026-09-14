import { describe, expect, it } from "vitest";
import type { RagdollCause } from "@dont-fall/shared";
import { detectHitTaken } from "./hitTaken.js";

const character = (overrides: { hitReactEpoch?: number; ragdollEpoch?: number; ragdollCause?: RagdollCause } = {}) => ({
  hitReactEpoch: 0,
  ragdollEpoch: 0,
  ragdollCause: "Fall" as RagdollCause,
  ...overrides,
});

describe("detectHitTaken", () => {
  it("fires when your own hitReactEpoch rises — a landed Hit, authoritatively resolved", () => {
    const event = detectHitTaken({
      previous: { hitReactEpoch: 4, ragdollEpoch: 1 },
      character: character({ hitReactEpoch: 5, ragdollEpoch: 1 }),
    });

    expect(event).toEqual({ knockedDown: false });
  });

  it("stays silent when nothing rose — ordinary snapshots are not events", () => {
    expect(
      detectHitTaken({
        previous: { hitReactEpoch: 4, ragdollEpoch: 1 },
        character: character({ hitReactEpoch: 4, ragdollEpoch: 1 }),
      }),
    ).toBeNull();
  });

  it("reads KNOCKED DOWN when both edges land in one snapshot gap — the down subsumes the tag", () => {
    const event = detectHitTaken({
      previous: { hitReactEpoch: 4, ragdollEpoch: 1 },
      character: character({ hitReactEpoch: 5, ragdollEpoch: 2, ragdollCause: "Hit" }),
    });

    expect(event).toEqual({ knockedDown: true });
  });

  it("reads KNOCKED DOWN when the down edge arrives a gap after the Hit — the real N/N+1 split", () => {
    // The landing resolved last gap (that flash already played); this gap
    // only the deferred Ragdoll entry lands, with cause Hit.
    const event = detectHitTaken({
      previous: { hitReactEpoch: 5, ragdollEpoch: 1 },
      character: character({ hitReactEpoch: 5, ragdollEpoch: 2, ragdollCause: "Hit" }),
    });

    expect(event).toEqual({ knockedDown: true });
  });

  it("never re-fires off a stale snapshot — older-or-equal epochs are not an edge", () => {
    expect(
      detectHitTaken({
        previous: { hitReactEpoch: 5, ragdollEpoch: 2 },
        character: character({ hitReactEpoch: 4, ragdollEpoch: 1, ragdollCause: "Hit" }),
      }),
    ).toBeNull();
  });

  it("a knockdown from anything else is not a Hit knockdown — a coinciding tag still reads plain", () => {
    const event = detectHitTaken({
      previous: { hitReactEpoch: 4, ragdollEpoch: 1 },
      character: character({ hitReactEpoch: 5, ragdollEpoch: 2, ragdollCause: "Fall" }),
    });

    expect(event).toEqual({ knockedDown: false });
  });

  it("a knockdown alone, with no fresh Hit, fires nothing — falling off is not being hit", () => {
    expect(
      detectHitTaken({
        previous: { hitReactEpoch: 4, ragdollEpoch: 1 },
        character: character({ hitReactEpoch: 4, ragdollEpoch: 2, ragdollCause: "Fall" }),
      }),
    ).toBeNull();
  });

  it("cold start seeds, never fires — joining mid-Match onto nonzero epochs is not a fresh Hit", () => {
    expect(
      detectHitTaken({
        previous: null,
        character: character({ hitReactEpoch: 9, ragdollEpoch: 3, ragdollCause: "Hit" }),
      }),
    ).toBeNull();
  });

  it("fires nothing with no Character to read — no run, no flash", () => {
    expect(
      detectHitTaken({ previous: { hitReactEpoch: 4, ragdollEpoch: 1 }, character: undefined }),
    ).toBeNull();
  });
});
