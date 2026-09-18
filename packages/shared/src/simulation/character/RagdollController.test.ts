import { describe, expect, it } from "vitest";
import { vec3 } from "../../math/vec3.js";
import { stripIntoImpact } from "./RagdollController.js";

describe("stripIntoImpact — a knockdown never keeps velocity into what it hit (found live 2026-09-18)", () => {
  it("strips the component against the impulse, keeps the lateral and vertical parts", () => {
    // Dashing +x into a wall whose shove points −x, with some slide along z
    // and a fall underway: only the +x (into the wall) part goes.
    const launch = stripIntoImpact(vec3(4, -2, 3), vec3(-14, 5, 0));
    expect(launch.x).toBeCloseTo(0, 9);
    expect(launch.y).toBeCloseTo(-2, 9);
    expect(launch.z).toBeCloseTo(3, 9);
  });

  it("touches nothing when the body already moves away from the collision", () => {
    expect(stripIntoImpact(vec3(-4, 1, 3), vec3(-14, 5, 0))).toEqual(vec3(-4, 1, 3));
  });

  it("strips by the collision's own angle — a diagonal shove removes the diagonal into-component", () => {
    const away = vec3(-1, 0, -1); // shove toward −x−z: the obstacle sits toward +x+z
    const launch = stripIntoImpact(vec3(2, 0, 0), away);
    // The (+x+z)-ward half of the motion goes; what remains slides along the obstacle.
    expect(launch.x + launch.z).toBeCloseTo(0, 9);
    expect(launch.x).toBeCloseTo(1, 9);
    expect(launch.z).toBeCloseTo(-1, 9);
  });

  it("names no obstacle direction when the impulse is vertical — a squash from above strips nothing", () => {
    expect(stripIntoImpact(vec3(4, 0, 3), vec3(0, 9, 0))).toEqual(vec3(4, 0, 3));
  });
});
