import type { Track, TrackListing } from "@dont-fall/shared";

export type { TrackListing };

export interface StoredTrackResponse {
  id: string;
  name: string | null;
  track: Track;
}

/** Saves a Track to track-service (ticket 02's `POST /tracks`). */
export const saveTrack = async (baseUrl: string, name: string, track: Track): Promise<{ id: string }> => {
  const res = await fetch(`${baseUrl}/tracks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(name ? { name, track } : { track }),
  });
  if (!res.ok) throw new Error(`save failed: HTTP ${res.status}`);
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
