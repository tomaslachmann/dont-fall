import type { Track, TrackListing } from "@dont-fall/shared";

export type { TrackListing };

export interface StoredTrackResponse {
  id: string;
  name: string | null;
  track: Track;
  /** The Time Limit this Revision was published with (M4 ticket 03, ADR 0038). */
  timeLimitMs: number;
}

/**
 * Saves a Track to track-service (ticket 02's `POST /tracks`). `timeLimitMs`
 * is written with the new Revision (M4 ticket 03, ADR 0038) — each publish
 * carries whatever the Draft's Time Limit says at that moment.
 */
export const saveTrack = async (
  baseUrl: string,
  name: string,
  track: Track,
  timeLimitMs: number,
): Promise<{ id: string }> => {
  const res = await fetch(`${baseUrl}/tracks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(name ? { name, track, timeLimitMs } : { track, timeLimitMs }),
  });
  if (!res.ok) throw new Error(`save failed: HTTP ${res.status}`);
  return (await res.json()) as { id: string };
};

/**
 * One fixed, reserved trackId every Playtest click republishes to (ADR 0032's
 * Revision model, "true simulation" grilling session, 2026-09) — never the
 * user's own curated Save id/name. `GET /tracks` (Browse) only ever lists a
 * distinct id's *latest* Revision, so however many times Playtest is
 * clicked, the real track list never gains a second row for it.
 */
export const PLAYTEST_TRACK_ID = "track-builder-playtest";

/**
 * Publishes the in-progress (possibly never-`Save`d) Track under
 * {@link PLAYTEST_TRACK_ID} so the real `apps/server` can load it by id —
 * the Playtest button's own handoff to the real multiplayer game, replacing
 * the old local-only `playtest.ts` scene entirely (grilling session, 2026-09:
 * "true simulation, not some bean").
 */
export const publishPlaytestTrack = async (
  baseUrl: string,
  track: Track,
  timeLimitMs: number,
): Promise<{ id: string }> => {
  const res = await fetch(`${baseUrl}/tracks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: PLAYTEST_TRACK_ID, name: "Track Builder Playtest", track, timeLimitMs }),
  });
  if (!res.ok) throw new Error(`publish failed: HTTP ${res.status}`);
  return (await res.json()) as { id: string };
};

/** Loads a Track from track-service by id (`GET /tracks/:id`). */
export const loadTrack = async (baseUrl: string, id: string): Promise<StoredTrackResponse> => {
  const res = await fetch(`${baseUrl}/tracks/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`load failed: HTTP ${res.status}`);
  return (await res.json()) as StoredTrackResponse;
};

/** Lists every stored Track (`GET /tracks`, ticket 09) — the Browse panel's data source. */
export const listTracks = async (baseUrl: string): Promise<TrackListing[]> => {
  const res = await fetch(`${baseUrl}/tracks`);
  if (!res.ok) throw new Error(`list failed: HTTP ${res.status}`);
  return (await res.json()) as TrackListing[];
};
