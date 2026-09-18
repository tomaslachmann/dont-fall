import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { BASE_BODY_COLOR_ID, BODY_COLOR_HUES, DEFAULT_BODY_COLOR } from "@dont-fall/shared";
import { paintModel, tintHueForColor, tintModel } from "./playerTint.js";

describe("tintHueForColor", () => {
  it("reads the equipped color's own hue off the shared table", () => {
    for (let color = 0; color < BODY_COLOR_HUES.length; color += 1) {
      expect(tintHueForColor(color)).toBe(BODY_COLOR_HUES[color]);
    }
  });

  it("falls back to the default color for anonymous seats and unknown color ids — never a made-up color", () => {
    const fallback = BODY_COLOR_HUES[DEFAULT_BODY_COLOR];
    expect(tintHueForColor(null)).toBe(fallback);
    expect(tintHueForColor(99)).toBe(fallback);
    expect(tintHueForColor(-1)).toBe(fallback);
    expect(tintHueForColor(1.5)).toBe(fallback);
  });

  it("returns null for the base color — BLIP's own authored cream, explicitly untinted", () => {
    expect(tintHueForColor(BASE_BODY_COLOR_ID)).toBeNull();
  });
});

describe("body looks", () => {
  const BODY_COLOR = 0xf3dfc3; // BLIP's own vanilla cream
  const EYE_COLOR = 0x060606; // BLIP's own warm obsidian

  /**
   * A BLIP-shaped rig as the skins GLB ships it (ADR 0091): one body mesh
   * whose material already carries a base-color map, plus two eye meshes
   * sharing one untextured eye material.
   */
  const blipRig = () => {
    const root = new THREE.Group();
    const factoryMap = new THREE.Texture();
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, map: factoryMap });
    bodyMaterial.name = "Skin / StarterCream";
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), bodyMaterial);
    const eyeMaterial = new THREE.MeshStandardMaterial({ color: EYE_COLOR });
    eyeMaterial.name = "Eyes · warm obsidian";
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), eyeMaterial);
    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), eyeMaterial);
    root.add(body, eyeL, eyeR);
    return { root, bodyMaterial, eyeMaterial, factoryMap };
  };

  const materialOf = (mesh: THREE.Object3D): THREE.MeshStandardMaterial =>
    (mesh as THREE.Mesh).material as THREE.MeshStandardMaterial;
  const colorOf = (mesh: THREE.Object3D): number => materialOf(mesh).color.getHex();

  it("recolors the body but never the eyes", () => {
    const { root } = blipRig();

    tintModel(root, 120);

    const [body, eyeL, eyeR] = root.children as THREE.Mesh[];
    expect(colorOf(body!)).not.toBe(BODY_COLOR);
    expect(colorOf(eyeL!)).toBe(EYE_COLOR);
    expect(colorOf(eyeR!)).toBe(EYE_COLOR);
  });

  it("null is BLIP's own cream — the base color, flat, written rather than restored", () => {
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

  it("a color clears the body's texture — a tinted leopard is nobody's idea (ADR 0091)", () => {
    const { root } = blipRig();

    tintModel(root, 120);

    const [body] = root.children as THREE.Mesh[];
    expect(materialOf(body!).map).toBeNull();
    // A map going away changes the compiled shader. `needsUpdate` is a
    // write-only accessor in three; `version` is what it bumps, so that is
    // what "was told to recompile" reads as.
    expect(materialOf(body!).version).toBeGreaterThan(0);
  });

  it("a skin paints the body and drops the color multiplier to white", () => {
    const { root } = blipRig();
    const skin = new THREE.Texture();
    tintModel(root, 120);

    paintModel(root, skin);

    const [body, eyeL] = root.children as THREE.Mesh[];
    expect(materialOf(body!).map).toBe(skin);
    expect(colorOf(body!)).toBe(0xffffff);
    // The eyes are not part of the body: a skin never reaches them.
    expect(materialOf(eyeL!).map).toBeNull();
    expect(colorOf(eyeL!)).toBe(EYE_COLOR);
  });

  it("taking a skin off reveals the color under it", () => {
    const { root } = blipRig();
    paintModel(root, new THREE.Texture());

    tintModel(root, BODY_COLOR_HUES[2]!);

    const [body] = root.children as THREE.Mesh[];
    expect(materialOf(body!).map).toBeNull();
    expect(colorOf(body!)).not.toBe(0xffffff);
  });

  it("still clones the eye materials — per-rig disposal must never free a shared instance", () => {
    const { root, eyeMaterial } = blipRig();

    tintModel(root, 120);

    const [, eyeL, eyeR] = root.children as THREE.Mesh[];
    expect((eyeL!.material as THREE.Material) !== eyeMaterial).toBe(true);
    expect((eyeR!.material as THREE.Material) !== eyeMaterial).toBe(true);
  });
});
