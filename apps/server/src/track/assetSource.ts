import { loadAssetLibrary, type Module } from "@dont-fall/shared";

/**
 * Fetches every asset Module's bytes through track-service and shapes the
 * asset half of the Module library (M8 ticket 02, ADR 0050 as amended).
 * Called once at boot — fetch-once-per-loader, so a mid-Match art edit
 * cannot split this server from the world it already built. (The documented
 * window is the *clients'* own fetch landing on different bytes; nothing
 * this server can do about someone else's HTTP timing.)
 */
export const fetchAssetLibrary = async (trackServiceUrl: string): Promise<Record<string, Module>> =>
  loadAssetLibrary(async (url: string): Promise<Uint8Array> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} answered ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }, `${trackServiceUrl}/assets`);
