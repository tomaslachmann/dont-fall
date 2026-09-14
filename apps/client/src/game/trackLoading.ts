import {
  ASSET_MODULE_DEFS,
  MODULE_LIBRARY,
  loadAssetLibrary,
  type Module,
  type Track,
} from "@dont-fall/shared";
import type * as THREE from "three";
import { resolveEndpoints } from "../lib/socket/connection.js";
import { loadAssetVisuals } from "../render/assetVisuals.js";

/**
 * Everything either game boot needs from the API (m8.1 ticket 01):
 * the Track itself, the collision library and the visual templates. Factored
 * out of match boot (`game/index.ts`) so the practice session boots through
 * the identical pipe — same fetch-once caching, same URL derivation, same
 * dev warnings — rather than forking a second copy that could drift.
 *
 * Fetching only: this never opens a socket, so the practice path that uses
 * it stays server-free by construction (`practice.test.ts` pins that).
 */
export interface TrackLoading {
  /** `GET {apiUrl}/tracks/:id` — revision omitted means latest. */
  fetchTrack: (trackId: string, trackRevision?: number) => Promise<{ track: Track; name: string | null }>;
  /** Collision library, session-cached (M8 ticket 02, ADR 0050 as amended). */
  loadLibrary: () => Promise<Record<string, Module>>;
  /** Visual templates, session-cached alongside the library (M8 ticket 03). */
  loadVisualTemplates: () => Promise<Record<string, THREE.Group>>;
}

export const createTrackLoading = (host: string | undefined): TrackLoading => {
  const endpoints = resolveEndpoints(host ?? location.hostname);

  const fetchTrack = async (trackId: string, trackRevision?: number): Promise<{ track: Track; name: string | null }> => {
    const url =
      trackRevision === undefined
        ? `${endpoints.apiUrl}/tracks/${trackId}`
        : `${endpoints.apiUrl}/tracks/${trackId}?revision=${trackRevision}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`could not fetch Track ${trackId}${trackRevision === undefined ? "" : `@${trackRevision}`} from the API: HTTP ${res.status}`);
    }
    const { track, name } = (await res.json()) as { track: Track; name: string | null };
    return { track, name };
  };

  // One `fetchBytes` serves both loaders (M8 ticket 03): the collision half
  // (`loadAssetLibrary`) and the visual half (`loadAssetVisuals`) parse the
  // same bytes twice with different code — "two loaders, one truth" — so
  // they share one promise cache and no URL is ever fetched twice per
  // session, however the two loads interleave.
  const fetchedBytes = new Map<string, Promise<Uint8Array>>();
  const fetchBytes = (url: string): Promise<Uint8Array> => {
    const cached = fetchedBytes.get(url);
    if (cached) return cached;
    const pending = (async (): Promise<Uint8Array> => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`GET ${url} answered ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    })();
    fetchedBytes.set(url, pending);
    return pending;
  };
  const assetsBaseUrl = `${endpoints.apiUrl}/assets`;

  let assetLibrary: Record<string, Module> | null = null;
  const loadLibrary = async (): Promise<Record<string, Module>> => {
    if (!assetLibrary) {
      const assets = await loadAssetLibrary(
        fetchBytes,
        assetsBaseUrl,
        ASSET_MODULE_DEFS,
        // Ticket 01's visual-escapes-collision check, surfaced where a
        // developer will see it (a dev warning, never an error).
        (moduleId, warning) => console.warn(`DON'T FALL: asset "${moduleId}": ${warning}`),
      );
      assetLibrary = { ...MODULE_LIBRARY, ...assets };
    }
    return assetLibrary;
  };

  let assetTemplates: Record<string, THREE.Group> | null = null;
  const loadVisualTemplates = async (): Promise<Record<string, THREE.Group>> => {
    if (!assetTemplates) {
      assetTemplates = await loadAssetVisuals(
        fetchBytes,
        assetsBaseUrl,
        ASSET_MODULE_DEFS.map((def) => def.id),
      );
    }
    return assetTemplates;
  };

  return { fetchTrack, loadLibrary, loadVisualTemplates };
};
