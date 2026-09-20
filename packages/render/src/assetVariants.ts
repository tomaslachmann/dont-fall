import { SEGMENT_COLOR_HUES, authoredPaintFileId, type SegmentColorId } from "@dont-fall/shared";
import * as THREE from "three";

/**
 * Flat-tint saturation/lightness — the character's own (`playerTint` in
 * `apps/client`, kept in sync by hand like the `extractVisualRoot` twins), so
 * a flat-painted Segment reads as the same color family as a bean. The hue
 * alone varies per paint.
 */
const TINT_SATURATION = 0.55;
const TINT_LIGHTNESS = 0.55;

/**
 * Session cache of flat-tinted Asset templates, per (file, paint) — the same
 * discipline as the client's shared texture cache: the source templates are
 * session-stable object identities (the game and the builder both cache per
 * id), so a variant built once stays valid, and a scene-graph sweep's dispose
 * only frees GPU copies three.js re-uploads on next render.
 */
const tintedVariants = new Map<string, THREE.Group>();

/**
 * A flat-painted copy of an Asset visual template: the character's
 * `tintModel`, minus the eyes predicate (a Segment has no named parts to
 * spare — the whole piece takes the paint). Every material is cloned, its
 * color set to the paint's hue and its map cleared: a flat bean, and the two
 * looks never blend. Geometry is shared with the source, never cloned — and
 * the source template itself is never written, so the canonical stays
 * canonical no matter how many colors derive from it.
 *
 * Materials without a map come through restyled too (their color is the whole
 * look either way); materials without a color are cloned but left alone.
 */
const tintTemplate = (template: THREE.Group, hue: number): THREE.Group => {
  const color = new THREE.Color().setHSL(hue / 360, TINT_SATURATION, TINT_LIGHTNESS);
  const copy = template.clone(true);
  copy.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const restyled = materials.map((material) => {
      const own = material.clone();
      if (!("color" in own) || !(own.color instanceof THREE.Color)) return own;
      const standard = own as THREE.MeshStandardMaterial;
      standard.color.copy(color);
      if (standard.map !== null) {
        standard.map = null;
        // A map leaving changes the shader the material compiles to — three
        // only notices when told (the character's `restyleBody` does the same).
        own.needsUpdate = true;
      }
      return own;
    });
    mesh.material = Array.isArray(mesh.material) ? restyled : restyled[0]!;
  });
  return copy;
};

/**
 * The template a placement draws. Paint works the way the character's does
 * (ADR 0091), and never touches a pixel:
 *
 * - an authored hue (red/blue/green/yellow) on a family member wears that
 *   hue's own file outright — `X_red` + blue draws `X_blue.glb`'s bytes, the
 *   UV mapping KayKit authored included. Red on the canonical is the file
 *   itself, no variant at all.
 * - anything else — a new hue (orange/cyan/purple/pink), or paint on a lone
 *   look — tints the file flat, built once per (file, paint) and shared by
 *   every placement wearing it.
 *
 * A paint file still loading falls back to the flat tint (the character's
 * `SkinCloset`: a color now, the authored art when it arrives) — picking a
 * color never blanks its Segment, and the next rebuild draws the file. Only
 * a missing *placed* file throws, the error both apps' loaders document.
 */
export const templateForPlacement = (
  templates: Record<string, THREE.Group>,
  moduleId: string,
  color: SegmentColorId | undefined,
): THREE.Group => {
  const template = templates[moduleId];
  if (!template) throw new Error(`asset "${moduleId}": no loaded visual template (fetch it before placing)`);
  if (color === undefined) return template;
  const fileId = authoredPaintFileId(moduleId, color);
  if (fileId !== null) {
    const file = templates[fileId];
    if (file) return file;
  }
  const key = `${moduleId} ${color}`;
  let variant = tintedVariants.get(key);
  if (!variant) {
    variant = tintTemplate(template, SEGMENT_COLOR_HUES[color]);
    tintedVariants.set(key, variant);
  }
  return variant;
};
