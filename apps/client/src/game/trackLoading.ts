import {
  ASSET_MODULE_DEFS,
  MODULE_LIBRARY,
  loadAssetLibrary,
  resolveEnvironmentId,
  type EnvironmentId,
  type Module,
  type Track,
} from "@dont-fall/shared";
import type * as THREE from "three";
import { resolveEndpoints } from "../lib/socket/connection.js";
import { loadAssetVisuals } from "../render/assetVisuals.js";
import { loadIceTexture } from "../render/iceOverlays.js";
import { loadMudTexture } from "../render/mudOverlays.js";
import { loadBounceTexture } from "../render/bounceSheets.js";

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
/** What a game boot takes from one fetched Revision. */
export interface FetchedRevision {
  track: Track;
  name: string | null;
  /**
   * The Environment it is drawn inside (ADR 0074). Always one this build has:
   * an id it does not know, from a newer API, falls back to the default with
   * a dev warning, never an error — a cosmetic must never brick boot.
   */
  environment: EnvironmentId;
}

export interface TrackLoading {
  /** `GET {apiUrl}/tracks/:id` — revision omitted means latest. */
  fetchTrack: (trackId: string, trackRevision?: number) => Promise<FetchedRevision>;
  /** Collision library, session-cached (M8 ticket 02, ADR 0050 as amended). */
  loadLibrary: () => Promise<Record<string, Module>>;
  /** Visual templates, session-cached alongside the library (M8 ticket 03). */
  loadVisualTemplates: () => Promise<Record<string, THREE.Group>>;
  /**
   * The shared ice texture (ADR 0066), session-cached like the templates —
   * or null when it cannot be loaded (an older API, a failed fetch/decode).
   * A cosmetic must never brick boot, so the failure degrades to untextured
   * ice (a dev warning, never an error) instead of rejecting.
   */
  loadIceTexture: () => Promise<THREE.Texture | null>;
  /**
   * The shared mud texture (ADR 0067) — the same session-cached,
   * degrade-to-null contract as the ice texture above.
   */
  loadMudTexture: () => Promise<THREE.Texture | null>;
  /** The shared bounce sheet texture, cached per session; `null` when it could not be loaded (ADR 0070). */
  loadBounceTexture: () => Promise<THREE.Texture | null>;
}

export const createTrackLoading = (host: string | undefined): TrackLoading => {
  const endpoints = resolveEndpoints(host ?? location.hostname);

  const fetchTrack = async (trackId: string, trackRevision?: number): Promise<FetchedRevision> => {
    const url =
      trackRevision === undefined
        ? `${endpoints.apiUrl}/tracks/${trackId}`
        : `${endpoints.apiUrl}/tracks/${trackId}?revision=${trackRevision}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`could not fetch Track ${trackId}${trackRevision === undefined ? "" : `@${trackRevision}`} from the API: HTTP ${res.status}`);
    }
    const body = (await res.json()) as { track: Track; name: string | null; environment?: unknown };
    const environment = resolveEnvironmentId(body.environment);
    if (environment.warning) console.warn(`DON'T FALL: Track ${trackId}: ${environment.warning}`);
    return { track: body.track, name: body.name, environment: environment.id };
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

  let iceTexture: THREE.Texture | null | undefined;
  const loadIceTextureCached = async (): Promise<THREE.Texture | null> => {
    if (iceTexture === undefined) {
      try {
        iceTexture = await loadIceTexture(fetchBytes, assetsBaseUrl);
      } catch (err) {
        console.warn(`DON'T FALL: ice overlay unavailable: ${(err as Error).message}`);
        iceTexture = null;
      }
    }
    return iceTexture;
  };

  let mudTexture: THREE.Texture | null | undefined;
  const loadMudTextureCached = async (): Promise<THREE.Texture | null> => {
    if (mudTexture === undefined) {
      try {
        mudTexture = await loadMudTexture(fetchBytes, assetsBaseUrl);
      } catch (err) {
        console.warn(`DON'T FALL: mud overlay unavailable: ${(err as Error).message}`);
        mudTexture = null;
      }
    }
    return mudTexture;
  };

  let bounceTexture: THREE.Texture | null | undefined;
  const loadBounceTextureCached = async (): Promise<THREE.Texture | null> => {
    if (bounceTexture === undefined) {
      try {
        bounceTexture = await loadBounceTexture(fetchBytes, assetsBaseUrl);
      } catch (err) {
        console.warn(`DON'T FALL: bounce sheet unavailable: ${(err as Error).message}`);
        bounceTexture = null;
      }
    }
    return bounceTexture;
  };

  return {
    fetchTrack,
    loadLibrary,
    loadVisualTemplates,
    loadIceTexture: loadIceTextureCached,
    loadMudTexture: loadMudTextureCached,
    loadBounceTexture: loadBounceTextureCached,
  };
};
