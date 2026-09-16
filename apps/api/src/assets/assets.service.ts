import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

/**
 * Served Module art (M8 ticket 02, ADR 0050 as amended) — the one pipe every
 * loader fetches bytes through, instead of per-app `public/` copies that
 * drift silently. Revisions float (latest wins); in-match consistency comes
 * from fetch-once-per-loader, with the documented mid-fetch-edit window —
 * revision-pinned art belongs to the content-pipeline milestone. GLB
 * Modules since M8, shared image maps (ADR 0066's ice texture) since.
 */

export const ASSET_CONTENT_TYPE = "model/gltf-binary";

/** Content type per served suffix — GLB Modules plus shared image maps, nothing else. */
const CONTENT_TYPE_BY_SUFFIX: Record<string, string> = {
  glb: ASSET_CONTENT_TYPE,
  png: "image/png",
  jpg: "image/jpeg",
};

/** `<name>.(glb|png|jpg)` and nothing else — the charset leaves no room for traversal, nesting, or suffix games. */
const ASSET_FILE_PATTERN = /^([A-Za-z0-9_-]+)\.(glb|png|jpg)$/;

/**
 * The served file for a request pathname, or null when this route does not
 * serve it. Takes the already-parsed pathname (never the raw URL — the
 * query string must not reach the filename).
 */
export const parseAssetFileName = (pathname: string): string | null => {
  const prefix = "/assets/";
  if (!pathname.startsWith(prefix)) return null;
  const fileName = pathname.substring(prefix.length);
  return ASSET_FILE_PATTERN.test(fileName) ? fileName : null;
};

/** Default art dir: the repo's `assets/`, located from this source file so no caller depends on the working directory. */
export const defaultAssetsDir = (): string =>
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "assets");

/** Reads one served file byte-for-byte. Throws a naming error on missing files — the route maps it to 404. */
export const readAssetFile = async (assetsDir: string, fileName: string): Promise<{ bytes: Uint8Array; contentType: string }> => {
  let bytes: Uint8Array;
  try {
    // Normalized to a plain Uint8Array (not a Buffer) — every loader parses
    // exactly this type, on either side of the wire.
    bytes = new Uint8Array(await readFile(join(assetsDir, fileName)));
  } catch {
    throw new Error(`asset file not found: ${fileName}`);
  }
  const suffix = fileName.substring(fileName.lastIndexOf(".") + 1);
  const contentType = CONTENT_TYPE_BY_SUFFIX[suffix];
  if (!contentType) throw new Error(`asset file not served: ${fileName}`);
  return { bytes, contentType };
};
