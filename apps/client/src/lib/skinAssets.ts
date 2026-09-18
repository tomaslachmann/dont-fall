import { publicUrl } from "./publicUrl.js";

/**
 * Where a skin's files are served (ADR 0091). Kept apart from the renderer's
 * closet so the Screens can show a skin's icon without pulling three.js into
 * the menu bundle (ADR 0008) — exactly like `hatAssets.ts`.
 */

/** A skin's body texture (2048×2048 base color, sRGB). Only the skins someone is wearing are ever fetched. */
export const skinTextureUrl = (id: string): string => publicUrl(`models/skins/${id}.png`);

/** A skin's wardrobe icon (512×512, transparent). */
export const skinIconUrl = (id: string): string => publicUrl(`models/skins/${id}-icon.png`);
