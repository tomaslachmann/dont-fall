import { BODY_SKIN_HUES, bodySkinHue, DEFAULT_BODY_SKIN } from "@dont-fall/shared";
import * as THREE from "three";
import { isWornHat } from "./hats.js";

/** Tint saturation/lightness — the hue alone is what varies per skin. */
const TINT_SATURATION = 0.55;
const TINT_LIGHTNESS = 0.55;

/**
 * Materials a skin never recolors, by authored name — BLIP's `"Eyes · warm
 * obsidian"`. The bean's body takes the tint; the eyes keep their own color.
 * BLIP-specific by necessity (the names come from the artist), so a rig swap
 * re-examines this predicate along with the tint itself.
 */
const UNTINTED_MATERIALS = /^eyes\b/i;

/** `userData` key stashing the factory color the first tint overwrote, for the base restore. */
const FACTORY_COLOR_KEY = "factoryColor";

/**
 * A rig's tint hue (M9 ticket 15) — the equipped skin's own hue, `null` for
 * the base (factory colors), and the default skin's hue when no skin is
 * known. Every Character wears its Player's actual skin; a seat with none
 * (anonymous, or an unlock this client predates) wears the default, never a
 * made-up color.
 */
export const tintHueForSkin = (skin: number | null): number | null => {
  // `??` would swallow base's own `null` — only the unknown case defaults.
  const hue = bodySkinHue(skin);
  return hue === undefined ? BODY_SKIN_HUES[DEFAULT_BODY_SKIN]! : hue;
};

/**
 * Recolors a rig to `hue`, or restores its factory colors for `null` (the
 * base skin). Clones every mesh's material first — `SkeletonUtils.clone`
 * (like `Object3D.clone`) shares material references across every clone of
 * the same source by default, so tinting one player's rig without this would
 * visibly recolor every other clone (including the local Character's own
 * model) sharing that exact material instance. Eye materials are cloned but
 * never recolored; the first tint stashes the overwritten factory color on
 * the clone so a later base restores exactly what the artist authored.
 *
 * A worn hat (ADR 0083) is skipped whole: it keeps its own colors, and its
 * materials belong to the wardrobe, shared by everyone wearing that hat.
 */
export const tintModel = (root: THREE.Object3D, hue: number | null): void => {
  const color = hue === null ? null : new THREE.Color().setHSL(hue / 360, TINT_SATURATION, TINT_LIGHTNESS);
  traverseUnlessWorn(root, (object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const cloned = materials.map((material) => {
      const own = material.clone();
      if (!("color" in own) || !(own.color instanceof THREE.Color)) return own;
      if (UNTINTED_MATERIALS.test(own.name)) return own;
      if (color === null) {
        // The base restore — a rig that was never tinted has nothing stashed
        // and already wears factory colors, so there is nothing to do.
        if (typeof own.userData[FACTORY_COLOR_KEY] === "number") own.color.setHex(own.userData[FACTORY_COLOR_KEY]);
        return own;
      }
      own.userData[FACTORY_COLOR_KEY] ??= own.color.getHex();
      own.color.copy(color);
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
