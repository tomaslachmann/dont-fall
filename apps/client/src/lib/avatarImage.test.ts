import { describe, expect, it } from "vitest";
import { centreSquare } from "./avatarImage.js";

describe("centreSquare (ADR 0110)", () => {
  it("keeps the middle of a wide picture and of a tall one", () => {
    expect(centreSquare(800, 600)).toEqual({ x: 100, y: 0, size: 600 });
    expect(centreSquare(300, 500)).toEqual({ x: 0, y: 100, size: 300 });
  });
});
