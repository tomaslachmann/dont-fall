// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createNameplates, NAMEPLATE_MAX_DISTANCE, projectNameplate } from "./nameplates.js";

const cameraAt = (z: number): THREE.PerspectiveCamera => {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
  camera.position.set(0, 1.35, z);
  camera.lookAt(0, 1.35, 0);
  camera.updateMatrixWorld();
  return camera;
};

describe("projectNameplate (ADR 0110)", () => {
  it("puts a head straight ahead at the screen's centre", () => {
    const at = projectNameplate(cameraAt(10), 800, 600, { x: 0, y: 0, z: 0 });
    expect(at!.x).toBeCloseTo(400);
    expect(at!.y).toBeCloseTo(300);
  });

  it("shows nothing behind the camera or past the distance a plate is worth", () => {
    expect(projectNameplate(cameraAt(10), 800, 600, { x: 0, y: 0, z: 20 })).toBeNull();
    expect(projectNameplate(cameraAt(NAMEPLATE_MAX_DISTANCE + 10), 800, 600, { x: 0, y: 0, z: 0 })).toBeNull();
  });
});

describe("the speaking cue (ADR 0111)", () => {
  /** The plates a Stage has drawn, in the order they were added. */
  const platesOf = (mount: HTMLElement): HTMLElement[] => [...mount.querySelectorAll("span")] as HTMLElement[];

  it("goes go-coloured while a Player talks, and back when they stop", () => {
    const mount = document.createElement("div");
    const plates = createNameplates(mount);
    const camera = cameraAt(10);
    const entry = { id: "p1", name: "Splatto", position: { x: 0, y: 0, z: 0 } };

    plates.update(camera, 800, 600, [entry], true);
    const quiet = platesOf(mount)[0]!.style.background;

    plates.update(camera, 800, 600, [{ ...entry, speaking: true }], true);
    const talking = platesOf(mount)[0]!.style.background;

    expect(talking).not.toBe(quiet);
    expect(talking).toContain("df-color-go");

    plates.update(camera, 800, 600, [entry], true);
    expect(platesOf(mount)[0]!.style.background).toBe(quiet);

    plates.dispose();
  });

  it("marks only the Player who is talking", () => {
    const mount = document.createElement("div");
    const plates = createNameplates(mount);

    plates.update(camera8(), 800, 600, [
      { id: "p1", name: "Splatto", position: { x: -1, y: 0, z: 0 }, speaking: true },
      { id: "p2", name: "Wobble", position: { x: 1, y: 0, z: 0 } },
    ], true);

    const [first, second] = platesOf(mount);
    expect(first!.style.background).toContain("df-color-go");
    expect(second!.style.background).not.toContain("df-color-go");

    plates.dispose();
  });
});

const camera8 = (): THREE.PerspectiveCamera => cameraAt(8);
