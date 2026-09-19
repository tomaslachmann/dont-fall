import { describe, expect, it } from "vitest";
import { SUPPORT_CODE_PATTERN } from "@dont-fall/shared";
import { newSupportCode } from "./errorReport.js";

describe("newSupportCode (ADR 0110)", () => {
  it("always makes a code the API accepts", () => {
    for (let n = 0; n < 200; n += 1) expect(newSupportCode()).toMatch(SUPPORT_CODE_PATTERN);
    expect(newSupportCode(() => 0)).toBe("DF-AAAA-AA");
    expect(newSupportCode(() => 0.9999)).toBe("DF-9999-99");
  });
});
