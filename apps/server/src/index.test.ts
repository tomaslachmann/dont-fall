import { CAPSULE_BOTTOM_OFFSET, DEFAULT_CHARACTER_ID } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { stepHeadless } from "./index.js";

describe("stepHeadless", () => {
  it("runs the shared RapierSimulation headlessly on the server", async () => {
    const state = await stepHeadless(10);
    expect(state.tick).toBe(10);
  });

  it("settles the character on the default ground under gravity", async () => {
    const state = await stepHeadless(120);
    const bottom = state.characters[DEFAULT_CHARACTER_ID]!.position.y - CAPSULE_BOTTOM_OFFSET;
    expect(bottom).toBeCloseTo(0, 1);
  });
});
