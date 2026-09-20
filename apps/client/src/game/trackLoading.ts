import {
  MODULE_LIBRARY,
  assetFileName,
  assetIdsOf,
  createAssetLibraryLoader,
  resolveEnvironmentId,
  visualAssetIdsOf,
  type EnvironmentId,
  type Module,
  type Track,
} from "@dont-fall/shared";
import type * as THREE from "three";
import { resolveEndpoints } from "../lib/socket/connection.js";
import { parseAssetVisual } from "../render/assetVisuals.js";
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
  /**
   * The Module library for `track`: the procedural registry plus the Assets
   * `track` places, each fetched and parsed once per session
   * (memory-footprint ticket 01, ADR 0080).
   */
  loadLibrary: (track: Track) => Promise<Record<string, Module>>;
  /** Visual templates for the Assets `track` places, cached per id beside the library (M8 ticket 03). */
  loadVisualTemplates: (track: Track) => Promise<Record<string, THREE.Group>>;
  /** The shared bounce sheet texture, cached per session; `null` when it could not be loaded (ADR 0070). */
  loadBounceTexture: () => Promise<THREE.Texture | null>;
  /** How many asset files this session downloaded, and their decoded bytes (M13 ticket 01). */
  fetchStats: () => { files: number; bytes: number };
}

type AssetHalf = "collision" | "visual";

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

  const fetched = { files: 0, bytes: 0 };
  const download = async (url: string): Promise<Uint8Array> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} answered ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    fetched.files += 1;
    fetched.bytes += bytes.byteLength;
    return bytes;
  };
  const assetsBaseUrl = `${endpoints.apiUrl}/assets`;

  // One download per Asset file serves both halves (M8 ticket 03): collision
  // and visuals parse the same bytes with different code ("two loaders, one
  // truth"), however their loads interleave. The cache lets go of a file's
  // bytes once both halves have taken them (memory-footprint ticket 01), so
  // they are freed when the second parse finishes; a failed download is
  // dropped at once, so the next load tries again.
  const glbBytes = new Map<string, { bytes: Promise<Uint8Array>; waiting: Set<AssetHalf> }>();
  const takeGlbBytes = (half: AssetHalf) => (url: string): Promise<Uint8Array> => {
    let entry = glbBytes.get(url);
    if (!entry) {
      const bytes = download(url);
      const created = { bytes, waiting: new Set<AssetHalf>(["collision", "visual"]) };
      glbBytes.set(url, created);
      bytes.catch(() => {
        if (glbBytes.get(url) === created) glbBytes.delete(url);
      });
      entry = created;
    }
    entry.waiting.delete(half);
    if (entry.waiting.size === 0) glbBytes.delete(url);
    return entry.bytes;
  };

  const collision = createAssetLibraryLoader(
    takeGlbBytes("collision"),
    assetsBaseUrl,
    // Ticket 01's visual-escapes-collision check, surfaced where a
    // developer will see it (a dev warning, never an error).
    (moduleId, warning) => console.warn(`DON'T FALL: asset "${moduleId}": ${warning}`),
  );
  const loadLibrary = async (track: Track): Promise<Record<string, Module>> => ({
    ...MODULE_LIBRARY,
    ...(await collision.load(assetIdsOf(track))),
  });

  const templates = new Map<string, Promise<THREE.Group>>();
  const takeVisualBytes = takeGlbBytes("visual");
  const loadTemplate = (moduleId: string): Promise<THREE.Group> => {
    const cached = templates.get(moduleId);
    if (cached) return cached;
    const url = `${assetsBaseUrl}/${assetFileName(moduleId)}`;
    const pending = (async (): Promise<THREE.Group> => {
      let bytes: Uint8Array;
      try {
        bytes = await takeVisualBytes(url);
      } catch (err) {
        throw new Error(`asset "${moduleId}": could not fetch ${url}: ${(err as Error).message}`);
      }
      return parseAssetVisual(moduleId, bytes);
    })();
    templates.set(moduleId, pending);
    pending.catch(() => {
      if (templates.get(moduleId) === pending) templates.delete(moduleId);
    });
    return pending;
  };
  const loadVisualTemplates = async (track: Track): Promise<Record<string, THREE.Group>> => {
    // Paint files included: an authored hue wears its own file (collision
    // above keeps `assetIdsOf` — physics never reads paint).
    const ids = visualAssetIdsOf(track);
    const loaded = await Promise.all(ids.map(loadTemplate));
    return Object.fromEntries(ids.map((id, i) => [id, loaded[i]!]));
  };

  let bounceTexture: THREE.Texture | null | undefined;
  const loadBounceTextureCached = async (): Promise<THREE.Texture | null> => {
    if (bounceTexture === undefined) {
      try {
        bounceTexture = await loadBounceTexture(download, assetsBaseUrl);
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
    loadBounceTexture: loadBounceTextureCached,
    fetchStats: () => ({ ...fetched }),
  };
};
