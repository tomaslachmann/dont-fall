import { AVATAR_DATA_URL_PREFIX, AVATAR_SIZE_PX } from "@dont-fall/shared";

/** The file types an avatar may be picked from (ADR 0110) — what the file input offers. */
export const AVATAR_ACCEPT = "image/png,image/jpeg,image/webp";

/** The centred square of a `width`×`height` picture — what an avatar keeps of it (ADR 0110). */
export const centreSquare = (width: number, height: number): { x: number; y: number; size: number } => {
  const size = Math.min(width, height);
  return { x: (width - size) / 2, y: (height - size) / 2, size };
};

/**
 * A picked picture as the avatar the API stores (ADR 0110): its centred
 * square, scaled to `AVATAR_SIZE_PX` a side, as a WebP data URL. Rejects a
 * file that is not a picture, and a browser that cannot write WebP (its canvas
 * hands back PNG instead) — the API accepts nothing else.
 */
export const avatarFromFile = async (file: Blob): Promise<string> => {
  const bitmap = await createImageBitmap(file);
  const { x, y, size } = centreSquare(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE_PX;
  canvas.height = AVATAR_SIZE_PX;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser can't draw the picture.");
  context.drawImage(bitmap, x, y, size, size, 0, 0, AVATAR_SIZE_PX, AVATAR_SIZE_PX);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/webp", 0.85);
  if (!dataUrl.startsWith(AVATAR_DATA_URL_PREFIX)) throw new Error("This browser can't save pictures as WebP.");
  return dataUrl;
};
