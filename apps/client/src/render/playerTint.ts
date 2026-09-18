import { BODY_COLOR_HUES, bodyColorHue, DEFAULT_BODY_COLOR } from "@dont-fall/shared";
import * as THREE from "three";
import { isWornHat } from "./hats.js";

/** Tint saturation/lightness — the hue alone is what varies per color. */
const TINT_SATURATION = 0.55;
const TINT_LIGHTNESS = 0.55;

/**
 * BLIP's own authored body color, worn by the base color id — the cream the
 * rig shipped flat before it had a UV map, and which its `starter-cream`
 * skin is still a flat fill of (sampled from the texture itself, which is
 * `#F3DFC3` across every UV island). Written as a color rather than restored
 * from the material, so no code has to remember what the model arrived
 * wearing.
 */
const BASE_BODY_HEX = 0xf3dfc3;

/**
 * Materials a body look never touches, by authored name — BLIP's `"Eyes ·
 * warm obsidian"`. The bean's body takes the color or the skin; the eyes
 * keep their own. BLIP-specific by necessity (the names come from the
 * artist), so a rig swap re-examines this predicate along with the look.
 */
const UNTINTED_MATERIALS = /^eyes\b/i;

/**
 * A rig's tint hue (M9 ticket 15) — the equipped color's own hue, `null` for
 * the base (BLIP's authored cream), and the default color's hue when none is
 * known. Every Character wears its Player's actual color; a seat with none
 * (anonymous, or an unlock this client predates) wears the default, never a
 * made-up color.
 *
 * Only ever reaches the rig on a bean wearing no skin (ADR 0091) — a skin
 * paints the whole body and the color underneath is simply not drawn.
 */
export const tintHueForColor = (color: number | null): number | null => {
  // `??` would swallow base's own `null` — only the unknown case defaults.
  const hue = bodyColorHue(color);
  return hue === undefined ? BODY_COLOR_HUES[DEFAULT_BODY_COLOR]! : hue;
};

/**
 * Recolors a rig's body to `hue`, or to BLIP's authored cream for `null`
 * (the base color). Clears any skin texture it was wearing: a color is a
 * flat bean, and the two looks never blend (ADR 0091).
 *
 * See {@link restyleBody} for why every call clones the rig's materials.
 */
export const tintModel = (root: THREE.Object3D, hue: number | null): void => {
  const color = hue === null ? new THREE.Color().setHex(BASE_BODY_HEX) : new THREE.Color().setHSL(hue / 360, TINT_SATURATION, TINT_LIGHTNESS);
  restyleBody(root, (material) => {
    material.color.copy(color);
    material.map = null;
  });
};

/**
 * Paints a rig's body with an equipped skin's texture (ADR 0091) — the
 * authored art wins outright, so the material's own color multiplier goes
 * white and the texture is the whole look. Every rig wearing a skin shares
 * that one texture; the material carrying it is this rig's own.
 */
export const paintModel = (root: THREE.Object3D, texture: THREE.Texture): void => {
  restyleBody(root, (material) => {
    material.color.setRGB(1, 1, 1);
    material.map = texture;
  });
};

/**
 * Applies `style` to every body material of `root`, giving the rig its own
 * copy of each first.
 *
 * The clone is not optional: `SkeletonUtils.clone` (like `Object3D.clone`)
 * shares material references across every clone of the same source, so
 * dressing one player's rig without it would visibly redress every other
 * clone of that material — the local Character's own model included.
 *
 * Eye materials are cloned but never styled, and a worn hat (ADR 0083) is
 * skipped whole: it keeps its own colors, and its materials belong to the
 * wardrobe, shared by everyone wearing that hat.
 */
const restyleBody = (root: THREE.Object3D, style: (material: THREE.MeshStandardMaterial) => void): void => {
  traverseUnlessWorn(root, (object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const cloned = materials.map((material) => {
      const own = material.clone();
      if (UNTINTED_MATERIALS.test(own.name)) return own;
      if (!("color" in own) || !(own.color instanceof THREE.Color)) return own;
      const before = (own as THREE.MeshStandardMaterial).map;
      style(own as THREE.MeshStandardMaterial);
      // A map arriving, leaving, or being swapped changes the shader the
      // material compiles to — three only notices when told.
      if ((own as THREE.MeshStandardMaterial).map !== before) own.needsUpdate = true;
      return own;
    });
    object.material = Array.isArray(object.material) ? cloned : cloned[0]!;
  });
};

/** `Object3D.traverse`, without descending into a worn hat. */
const traverseUnlessWorn = (object: THREE.Object3D, visit: (object: THREE.Object3D) => void): void => {
  if (isWornHat(object)) return;
  visit(object);
  for (const child of object.children) traverseUnlessWorn(child, visit);
};
