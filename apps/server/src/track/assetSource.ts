import { createAssetLibraryLoader, type AssetLibraryLoader } from "@dont-fall/shared";

/**
 * This Match server's Asset loader (M8 ticket 02, ADR 0050; per Track since
 * memory-footprint ticket 01, ADR 0080): each Asset Module's bytes come from
 * the API the first time a Track this server loads places it, and never again,
 * so a mid-Match art edit cannot split this server from a world it already
 * built. (The documented window is the clients' own fetch landing on
 * different bytes, and a later Track's first use of an id seeing a newer
 * revision than a boot-time fetch would have.)
 */
export const createServerAssetLoader = (trackServiceUrl: string): AssetLibraryLoader =>
  createAssetLibraryLoader(async (url: string): Promise<Uint8Array> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} answered ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }, `${trackServiceUrl}/assets`);
