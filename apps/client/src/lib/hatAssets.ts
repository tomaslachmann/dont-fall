import { publicUrl } from "./publicUrl.js";

/**
 * Where a hat's files are served (ADR 0083). Kept apart from the renderer's
 * wardrobe so the Screens can show a hat's icon without pulling three.js
 * into the menu bundle (ADR 0008).
 */

/** A hat's model. Only the hats someone is wearing are ever fetched. */
export const hatModelUrl = (id: string): string => publicUrl(`models/hats/${id}.glb`);

/** A hat's wardrobe icon (512×512, transparent). */
export const hatIconUrl = (id: string): string => publicUrl(`models/hats/${id}.png`);
