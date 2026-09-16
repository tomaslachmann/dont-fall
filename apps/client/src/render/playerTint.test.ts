import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { BASE_BODY_SKIN_ID, BODY_SKIN_HUES, DEFAULT_BODY_SKIN } from "@dont-fall/shared";
import { tintHueForSkin, tintModel } from "./playerTint.js";

describe("tintHueForSkin", () => {
  it("reads the equipped skin's own hue off the shared table", () => {
    for (let skin = 0; skin < BODY_SKIN_HUES.length; skin += 1) {
      expect(tintHueForSkin(skin)).toBe(BODY_SKIN_HUES[skin]);
    }
  });

  it("falls back to the default skin for anonymous seats and unknown skin ids — never a made-up color", () => {
    const fallback = BODY_SKIN_HUES[DEFAULT_BODY_SKIN];
    expect(tintHueForSkin(null)).toBe(fallback);
    expect(tintHueForSkin(99)).toBe(fallback);
    expect(tintHueForSkin(-1)).toBe(fallback);
    expect(tintHueForSkin(1.5)).toBe(fallback);
  });

  it("returns null for the base skin — factory colors, explicitly untinted", () => {
    expect(tintHueForSkin(BASE_BODY_SKIN_ID)).toBeNull();
  });
});

describe("tintModel", () => {
  const BODY_COLOR = 0xf3dfc3; // BLIP's own vanilla cream
  const EYE_COLOR = 0x060606; // BLIP's own warm obsidian

  /** A BLIP-shaped rig: one body mesh plus two eye meshes sharing one eye material. */
  const blipRig = () => {
    const root = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: BODY_COLOR });
    bodyMaterial.name = "Vanilla cream · F3DFC3";
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), bodyMaterial);
    const eyeMaterial = new THREE.MeshStandardMaterial({ color: EYE_COLOR });
    eyeMaterial.name = "Eyes · warm obsidian";
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), eyeMaterial);
    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), eyeMaterial);
    root.add(body, eyeL, eyeR);
    return { root, bodyMaterial, eyeMaterial };
  };

  const colorOf = (mesh: THREE.Object3D): number =>
    ((mesh as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHex();

  it("recolors the body but never the eyes", () => {
    const { root } = blipRig();

    tintModel(root, 120);

    const [body, eyeL, eyeR] = root.children as THREE.Mesh[];
    expect(colorOf(body!)).not.toBe(BODY_COLOR);
    expect(colorOf(eyeL!)).toBe(EYE_COLOR);
    expect(colorOf(eyeR!)).toBe(EYE_COLOR);
  });

  it("null restores the factory colors a tint overwrote — the base round-trip", () => {
    const { root } = blipRig();
    tintModel(root, 120);
    const [tinted] = root.children as THREE.Mesh[];
    expect(colorOf(tinted!)).not.toBe(BODY_COLOR);

    tintModel(root, null);

    const [body, eyeL, eyeR] = root.children as THREE.Mesh[];
    expect(colorOf(body!)).toBe(BODY_COLOR);
    expect(colorOf(eyeL!)).toBe(EYE_COLOR);
    expect(colorOf(eyeR!)).toBe(EYE_COLOR);
  });

  it("still clones the eye materials — per-rig disposal must never free a shared instance", () => {
    const { root, eyeMaterial } = blipRig();

    tintModel(root, 120);

    const [, eyeL, eyeR] = root.children as THREE.Mesh[];
    expect((eyeL!.material as THREE.Material) !== eyeMaterial).toBe(true);
    expect((eyeR!.material as THREE.Material) !== eyeMaterial).toBe(true);
  });
});
