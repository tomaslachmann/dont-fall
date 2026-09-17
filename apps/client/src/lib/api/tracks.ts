import { apiBaseUrl } from "./base.js";

/**
 * A Track's Thumbnail image URL (ADR 0085) — the API's raw-JPEG endpoint,
 * for `<img>` and CSS alike. The latest Revision's, unless `revision` pins
 * one (a live Match's client passes what its `WelcomeMessage` named, the
 * same reason `GET /tracks/:id` takes one). Callers check `hasThumbnail`
 * first — a thumbnail-less Track 404s here, by design.
 */
export const trackThumbnailUrl = (trackId: string, revision?: number): string =>
  `${apiBaseUrl()}/tracks/${encodeURIComponent(trackId)}/thumbnail${revision === undefined ? "" : `?revision=${revision}`}`;
