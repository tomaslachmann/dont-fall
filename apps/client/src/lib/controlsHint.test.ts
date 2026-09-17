import { DEFAULT_BINDINGS } from "@dont-fall/shared";
import { describe, expect, it } from "vitest";
import { controlsHint } from "./controlsHint.js";

describe("controlsHint", () => {
  it("renders the default layout exactly as the HUD always showed it", () => {
    expect(controlsHint(DEFAULT_BINDINGS)).toBe("WASD move · Space jump · Shift dash · F hit · G grab");
  });

  it("follows a rebind, dashes the unbound, shortens clicks", () => {
    expect(
      controlsHint({ ...DEFAULT_BINDINGS, jump: ["KeyJ"], hit: ["Mouse0"], dash: [], grab: ["Comma"] }),
    ).toBe("WASD move · J jump · — dash · LMB hit · , grab");
  });
});
