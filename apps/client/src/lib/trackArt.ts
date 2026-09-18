import type { CSSProperties } from "react";
import type { TrackListing } from "@dont-fall/shared";
import { trackThumbnailUrl } from "./api/tracks.js";

/**
 * A listed Track's picture, pinned to the Revision the listing names (ADR
 * 0105): immutable, so the browser keeps it for good once preloaded, and a
 * republish reads a fresh URL by itself. `undefined` when the Track has none
 * (ADR 0085's fallbacks take over).
 */
export const listedThumbnailUrl = (
  track: Pick<TrackListing, "id" | "revision" | "hasThumbnail"> | undefined,
): string | undefined => (track?.hasThumbnail ? trackThumbnailUrl(track.id, track.revision) : undefined);

/** The picture for `trackId`, looked up in a listing. */
export const thumbnailFor = (listing: readonly TrackListing[] | null, trackId: string | null | undefined): string | undefined =>
  trackId ? listedThumbnailUrl(listing?.find((track) => track.id === trackId)) : undefined;

/**
 * Inline style carrying a Track's picture as `--df-track-art` (ADR 0105), for
 * a background that reads `var(--df-track-art, none)`. With no picture the
 * property is absent and the fallback leaves whatever is layered under it.
 */
export const trackArtStyle = (url: string | undefined): CSSProperties =>
  (url === undefined ? {} : { "--df-track-art": `url("${url}")` }) as CSSProperties;

/** The picture layer over whatever the design draws under it, e.g. its stripes. */
export const TRACK_ART_LAYER = "var(--df-track-art, none) center / cover no-repeat";

/** Fetches and decodes one picture. Settles either way; the caller only waits on it. */
export type ImageLoader = (url: string) => Promise<void>;

// Every picture preloaded this visit, held so the decoded image stays in the
// document's image cache for whatever screen shows it next.
const held: HTMLImageElement[] = [];

const decodeImage: ImageLoader = (url) => {
  const image = new Image();
  held.push(image);
  image.src = url;
  // Without `decode` (jsdom), there is nothing to wait on.
  return typeof image.decode === "function" ? image.decode() : Promise.resolve();
};

const preloaded = new Map<string, Promise<void>>();

/**
 * Loads every listed Track's picture (ADR 0105), each URL once per visit.
 * Resolves when all of them have decoded or failed; a failed one never
 * rejects the rest, since every screen that shows a picture already falls back.
 */
export const preloadTrackArt = (listing: readonly TrackListing[], load: ImageLoader = decodeImage): Promise<void> => {
  const pending: Promise<void>[] = [];
  for (const track of Array.isArray(listing) ? listing : []) {
    const url = listedThumbnailUrl(track);
    if (url === undefined) continue;
    let settled = preloaded.get(url);
    if (settled === undefined) {
      settled = Promise.resolve()
        .then(() => load(url))
        .catch(() => undefined);
      preloaded.set(url, settled);
    }
    pending.push(settled);
  }
  return Promise.all(pending).then(() => undefined);
};

/** Test seam: forgets what this visit has preloaded. */
export const forgetPreloadedTrackArt = (): void => {
  preloaded.clear();
  held.length = 0;
};
