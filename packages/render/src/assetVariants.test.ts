import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { templateForPlacement } from "./assetVariants.js";

const RED = "kaykit_platform_6x6x1_red";
const BLUE = "kaykit_platform_6x6x1_blue";

/** A one-mesh template over a map — the file's own look. */
const fileTemplate = (): THREE.Group => {
  const map = new THREE.DataTexture(new Uint8ClampedArray([255, 0, 0, 255, 128, 128, 128, 255]), 2, 1);
  map.needsUpdate = true;
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map })));
  return group;
};

const materialOf = (template: THREE.Group): THREE.MeshStandardMaterial =>
  (template.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;

describe("templateForPlacement", () => {
  it("hands back the file's own template without paint, and throws unknown ids as ever", () => {
    const template = fileTemplate();
    expect(templateForPlacement({ piece: template }, "piece", undefined)).toBe(template);
    expect(() => templateForPlacement({ piece: template }, "nope", undefined)).toThrow(
      /asset "nope": no loaded visual template/,
    );
  });

  it("an authored hue wears its own file outright — the UV mapping KayKit authored included", () => {
    const red = fileTemplate();
    const blue = fileTemplate();
    const templates = { [RED]: red, [BLUE]: blue };
    // Identity, not a clone: the authored bytes are the whole look.
    expect(templateForPlacement(templates, RED, "blue")).toBe(blue);
    expect(templateForPlacement(templates, BLUE, "blue")).toBe(blue);
    // Red on the canonical is the file itself — no variant at all.
    expect(templateForPlacement(templates, RED, "red")).toBe(red);
  });

  it("tints flat while paint's file is still loading, and wears it once it lands", () => {
    const red = fileTemplate();
    const templates: Record<string, THREE.Group> = { [RED]: red };
    const interim = templateForPlacement(templates, RED, "blue");
    expect(materialOf(interim).map).toBeNull();

    const blue = fileTemplate();
    templates[BLUE] = blue;
    expect(templateForPlacement(templates, RED, "blue")).toBe(blue);
  });

  it("a new hue tints the file flat, once per (file, paint), never writing the source", () => {
    const template = fileTemplate();
    const templates = { [RED]: template };
    const orange = templateForPlacement(templates, RED, "orange");
    expect(templateForPlacement(templates, RED, "orange")).toBe(orange);
    expect(orange).not.toBe(template);

    const material = materialOf(orange);
    expect(material).not.toBe(materialOf(template));
    expect(material.map).toBeNull();
    const expected = new THREE.Color().setHSL(32 / 360, 0.55, 0.55);
    expect(material.color.getHex()).toBe(expected.getHex());
    // Geometry shared, materials own.
    expect((orange.children[0] as THREE.Mesh).geometry).toBe((template.children[0] as THREE.Mesh).geometry);
    // The canonical is untouched — the next paint derives from the same bytes.
    expect(materialOf(template).map).not.toBeNull();

    const purple = templateForPlacement(templates, RED, "purple");
    expect(purple).not.toBe(orange);
    expect(materialOf(purple).color.getHex()).not.toBe(material.color.getHex());
  });

  it("paints a legacy id from its stem, and a lone look flat", () => {
    const blue = fileTemplate();
    const yellow = fileTemplate();
    expect(templateForPlacement({ kaykit_platform_6x6x1_blue: blue, kaykit_platform_6x6x1_yellow: yellow }, "kaykit_platform_6x6x1_blue", "yellow")).toBe(
      yellow,
    );
    const lone = fileTemplate();
    const tinted = templateForPlacement({ kaykit_ball: lone }, "kaykit_ball", "blue");
    expect(tinted).not.toBe(lone);
    expect(materialOf(tinted).map).toBeNull();
  });
});
