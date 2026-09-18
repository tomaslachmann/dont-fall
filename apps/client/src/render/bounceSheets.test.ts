import { describe, expect, it } from "vitest";
import {
  BOUNCE_DOME_RISE,
  BOUNCE_PRESS_DEPTH,
  BOUNCE_WOBBLE_MS,
  CAPSULE_BOTTOM_OFFSET,
  IDENTITY_QUAT,
  eulerQuat,
  rotateVec3ByQuat,
  type BounceDeck,
  type RenderCharacter,
  type Vec3,
} from "@dont-fall/shared";
import * as THREE from "three";
import { BouncePresses, buildBounceSheets } from "./bounceSheets.js";

const DECK: BounceDeck = {
  segmentIndex: 2,
  deck: { center: { x: 0, y: 1, z: 0 }, yaw: 0, orientation: IDENTITY_QUAT, halfX: 3, halfZ: 3 },
};

/** A Character standing on the deck, unless `over` moves it. */
const character = (over: Partial<Vec3> & { grounded?: boolean; vy?: number } = {}): RenderCharacter =>
  ({
    position: { x: over.x ?? 0, y: over.y ?? 1 + CAPSULE_BOTTOM_OFFSET, z: over.z ?? 0 },
    bones: [],
    motionState: "Controlled",
    facing: 0,
    velocity: { x: 0, y: over.vy ?? 0, z: 0 },
    grounded: over.grounded ?? true,
    dashing: false,
    dashSpeed: 0,
    respawnCount: 0,
    eliminated: false,
    hitChargeMs: 0,
    ragdollEpoch: 0,
    ragdollCause: "Fall",
    hitEpoch: 0,
    hitReactEpoch: 0,
    grabEpoch: 0,
    launchPadEpoch: 0,
    grabbingId: null,
    heldByGrabberId: null,
    heldPhase: null,
    spinMs: 0,
  }) satisfies RenderCharacter;

/** The sheet's own vertex heights, nearest-first to a world x/z. */
const heightAt = (mesh: THREE.Mesh, x: number, z: number): number => {
  const position = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < position.count; i += 1) {
    const distance = Math.hypot(position.getX(i) - x, position.getZ(i) - z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = position.getY(i);
    }
  }
  return best;
};

describe("buildBounceSheets", () => {
  it("lays a convex sheet over the deck, pinned at the rim", () => {
    const [sheet] = buildBounceSheets([DECK], null);
    expect(sheet).toBeDefined();
    expect(heightAt(sheet!.object, 0, 0)).toBeCloseTo(BOUNCE_DOME_RISE, 6);
    expect(heightAt(sheet!.object, 3, 0)).toBeCloseTo(0, 6);
    expect(heightAt(sheet!.object, -3, 3)).toBeCloseTo(0, 6);
  });

  it("dents under a Character and springs back when they leave", () => {
    const [sheet] = buildBounceSheets([DECK], null);
    const rest = heightAt(sheet!.object, 0, 0);

    sheet!.update([{ position: { x: 0, y: 1 + CAPSULE_BOTTOM_OFFSET, z: 0 }, depth: BOUNCE_PRESS_DEPTH }]);
    const pressed = heightAt(sheet!.object, 0, 0);
    expect(pressed).toBeLessThan(rest);
    // …and only where they stand: the far side keeps its dome.
    expect(heightAt(sheet!.object, 2.5, 0)).toBeGreaterThan(pressed);

    sheet!.update([]);
    expect(heightAt(sheet!.object, 0, 0)).toBeCloseTo(rest, 6);
  });

  it("keeps the rim on the deck even when someone stands on the very edge", () => {
    const [sheet] = buildBounceSheets([DECK], null);
    sheet!.update([{ position: { x: 3, y: 1 + CAPSULE_BOTTOM_OFFSET, z: 0 }, depth: 2 }]);
    expect(heightAt(sheet!.object, 3, 0)).toBeCloseTo(0, 6);
    expect(heightAt(sheet!.object, 3, 3)).toBeCloseTo(0, 6);
  });

  it("lies in a pitched deck's plane, and dents where feet stand on the slope", () => {
    const orientation = eulerQuat(0, 0.3, 0);
    const pitched: BounceDeck = { segmentIndex: 2, deck: { ...DECK.deck, orientation } };
    const [sheet] = buildBounceSheets([pitched], null);
    const up = rotateVec3ByQuat({ x: 0, y: 1, z: 0 }, orientation);
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(sheet!.object.quaternion);
    expect(normal.distanceTo(new THREE.Vector3(up.x, up.y, up.z))).toBeCloseTo(0, 9);

    // Standing 2 m up the slope from the centre: feet on the tilted surface.
    const along = rotateVec3ByQuat({ x: 0, y: 0, z: -2 }, orientation);
    const rest = heightAt(sheet!.object, 0, -2);
    sheet!.update([
      { position: { x: along.x, y: 1 + along.y + CAPSULE_BOTTOM_OFFSET * up.y, z: along.z }, depth: BOUNCE_PRESS_DEPTH },
    ]);
    expect(heightAt(sheet!.object, 0, -2)).toBeLessThan(rest);
  });

  it("ignores someone flying over it — a press is feet on the sheet, not a shadow", () => {
    const [sheet] = buildBounceSheets([DECK], null);
    const rest = heightAt(sheet!.object, 0, 0);
    sheet!.update([{ position: { x: 0, y: 1 + CAPSULE_BOTTOM_OFFSET + 4, z: 0 }, depth: BOUNCE_PRESS_DEPTH }]);
    expect(heightAt(sheet!.object, 0, 0)).toBeCloseTo(rest, 6);
  });
});

describe("BouncePresses", () => {
  it("presses for everyone near the sheet, on their way down as well as standing", () => {
    const presses = new BouncePresses();
    expect(presses.update({ a: character() }, 0)).toEqual([
      { position: expect.anything(), depth: BOUNCE_PRESS_DEPTH },
    ]);
    // Still coming down: the skin should already be giving way, not waiting
    // for contact — how much is the sheet's own call, by height.
    expect(presses.update({ a: character({ grounded: false, vy: -6 }) }, 16)[0]!.depth).toBeCloseTo(
      BOUNCE_PRESS_DEPTH,
      10,
    );
  });

  it("yields part way for a Character still above the sheet, and not at all for one flying over", () => {
    const [sheet] = buildBounceSheets([DECK], null);
    const rest = heightAt(sheet!.object, 0, 0);

    // Half the reach up: a partial dent — the sheet is already giving way.
    sheet!.update([{ position: { x: 0, y: 1 + CAPSULE_BOTTOM_OFFSET + 0.35, z: 0 }, depth: BOUNCE_PRESS_DEPTH }]);
    const approaching = heightAt(sheet!.object, 0, 0);
    expect(approaching).toBeLessThan(rest);

    // Standing on it: deeper still.
    sheet!.update([{ position: { x: 0, y: 1 + CAPSULE_BOTTOM_OFFSET, z: 0 }, depth: BOUNCE_PRESS_DEPTH }]);
    expect(heightAt(sheet!.object, 0, 0)).toBeLessThan(approaching);
  });

  it("rings after a real landing, from the speed the fall actually reached", () => {
    const presses = new BouncePresses();
    // Falling fast…
    presses.update({ a: character({ grounded: false, vy: -18 }) }, 0);
    // …then thrown back up: the landing happened between these two frames, and
    // the speed that caused it is gone from the snapshot by now.
    const landed = presses.update({ a: character({ grounded: false, vy: 15 }) }, 16);
    expect(landed[0]!.depth).toBeGreaterThan(BOUNCE_PRESS_DEPTH); // the ring, on top of the ordinary press

    // Once the ring's window closes there is nothing left of it — just the
    // ordinary press of somebody standing near the sheet.
    const later = presses.update({ a: character({ grounded: false, vy: 10 }) }, 16 + BOUNCE_WOBBLE_MS);
    expect(later[0]!.depth).toBeCloseTo(BOUNCE_PRESS_DEPTH, 10);
  });

  it("does not ring for a gentle step down", () => {
    const presses = new BouncePresses();
    presses.update({ a: character({ grounded: false, vy: -1 }) }, 0);
    const stepped = presses.update({ a: character() }, 16);
    // The ordinary press only — nothing extra from the "landing".
    expect(stepped[0]!.depth).toBeCloseTo(BOUNCE_PRESS_DEPTH, 10);
    expect(presses.landings()).toEqual([]);
  });

  it("reports each landing for its frame only: who, where, and how fast (M14 ticket 05)", () => {
    const presses = new BouncePresses();
    presses.update({ a: character({ grounded: false, vy: -18 }), b: character({ x: 2, grounded: false, vy: -2 }) }, 0);
    expect(presses.landings()).toEqual([]);
    presses.update({ a: character({ grounded: false, vy: 15 }), b: character({ x: 2 }) }, 16);
    expect(presses.landings()).toEqual([{ id: "a", position: character().position, speed: 18 }]);
    presses.update({ a: character({ grounded: false, vy: 14 }), b: character({ x: 2 }) }, 32);
    expect(presses.landings()).toEqual([]);
  });

  it("answers every Character, not only the local one", () => {
    const presses = new BouncePresses();
    const frame = presses.update({ me: character(), them: character({ x: 2 }) }, 0);
    expect(frame).toHaveLength(2);
  });

  it("forgets a Character who leaves, and everything on reset", () => {
    const presses = new BouncePresses();
    presses.update({ a: character({ grounded: false, vy: -20 }) }, 0);
    expect(presses.update({}, 16)).toEqual([]); // nobody there to press anything
    // Back with the same id and the same fall: a fresh fall, not a resumed one.
    presses.update({ a: character({ grounded: false, vy: -20 }) }, 32);
    expect(presses.update({ a: character() }, 48)[0]!.depth).toBeGreaterThan(BOUNCE_PRESS_DEPTH);

    presses.reset();
    expect(presses.update({ a: character() }, 64)[0]!.depth).toBeCloseTo(BOUNCE_PRESS_DEPTH, 10);
  });
});
