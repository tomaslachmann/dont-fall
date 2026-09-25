import type {
  EnvironmentId,
  StoredTrack,
  Track,
  TrackDraft,
  TrackDraftListing,
  TrackListing,
  TrackRoundDefaults,
} from "@dont-fall/shared";

export type { StoredTrack, TrackDraft, TrackDraftListing, TrackListing, TrackRoundDefaults };

/**
 * Saves a Track to the API (ticket 02's `POST /tracks`). `defaults` —
 * the Time Limit (M4 ticket 03, ADR 0038) and the Survivor Target (M5 ticket
 * 07, ADR 0041) — is written with the new Revision: each publish carries
 * whatever the Draft's own fields say at that moment.
 *
 * Passed as one object rather than as positional numbers so a fourth
 * authored default can't be added at a call site by accident, and so
 * `defaults.survivorTarget` reads as itself at every call.
 *
 * `environment` (ADR 0074) is written with it, as its own argument: it is not
 * a Round default. `thumbnail` (ADR 0085) rides the same way — the capture
 * mode's screenshot data URL, omitted (never nulled) when there is none, so
 * a thumbnail-less publish sends exactly what it always sent.
 */
export const saveTrack = async (
  baseUrl: string,
  name: string,
  track: Track,
  defaults: TrackRoundDefaults,
  environment: EnvironmentId,
  thumbnail?: string,
): Promise<{ id: string }> => {
  const payload = name ? { name, track, ...defaults, environment } : { track, ...defaults, environment };
  const res = await fetch(`${baseUrl}/tracks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(thumbnail ? { ...payload, thumbnail } : payload),
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
  defaults: TrackRoundDefaults,
  environment: EnvironmentId,
): Promise<{ id: string }> => {
  const res = await fetch(`${baseUrl}/tracks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // The playtest boots the real client, which draws this Environment with its real fog.
    body: JSON.stringify({ id: PLAYTEST_TRACK_ID, name: "Track Builder Playtest", track, ...defaults, environment }),
  });
  if (!res.ok) throw new Error(`publish failed: HTTP ${res.status}`);
  return (await res.json()) as { id: string };
};

/** Loads a Track from the API by id (`GET /tracks/:id`). */
export const loadTrack = async (baseUrl: string, id: string): Promise<StoredTrack> => {
  const res = await fetch(`${baseUrl}/tracks/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`load failed: HTTP ${res.status}`);
  return (await res.json()) as StoredTrack;
};

/** Lists every stored Track (`GET /tracks`, ticket 09) — the Browse panel's data source. */
export const listTracks = async (baseUrl: string): Promise<TrackListing[]> => {
  const res = await fetch(`${baseUrl}/tracks`);
  if (!res.ok) throw new Error(`list failed: HTTP ${res.status}`);
  return (await res.json()) as TrackListing[];
};

/**
 * Every stored Draft, without Segments (`GET /drafts`) — the Browse panel's
 * second source. A Draft is the same thing the builder has always edited
 * (CONTEXT.md), only kept in the API instead of this tab, which is what lets
 * the MCP server (ADR 0114) and a person hand one back and forth.
 */
export const listDrafts = async (baseUrl: string): Promise<TrackDraftListing[]> => {
  const res = await fetch(`${baseUrl}/drafts`);
  if (!res.ok) throw new Error(`draft list failed: HTTP ${res.status}`);
  return (await res.json()) as TrackDraftListing[];
};

/** One stored Draft with its Segments (`GET /drafts/:id`). */
export const loadDraft = async (baseUrl: string, id: string): Promise<TrackDraft> => {
  const res = await fetch(`${baseUrl}/drafts/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`draft load failed: HTTP ${res.status}`);
  return (await res.json()) as TrackDraft;
};

/**
 * Writes an open Draft back where it came from: its Segments
 * (`PUT /drafts/:id/segments`) and then its publish metadata
 * (`PATCH /drafts/:id`). Two calls because the API keeps them apart — the
 * Segments PUT is what makes an MCP batch atomic — and Segments go first, so
 * a failed metadata patch still leaves the work saved.
 *
 * No thumbnail: a Draft has no column for one (it is framed at publish, ADR
 * 0085), which is why saving a Draft skips the capture flow a Revision needs.
 */
export const saveDraft = async (
  baseUrl: string,
  id: string,
  track: Track,
  meta: { name: string; defaults: TrackRoundDefaults; environment: EnvironmentId },
): Promise<TrackDraft> => {
  const url = `${baseUrl}/drafts/${encodeURIComponent(id)}`;
  const segments = await fetch(`${url}/segments`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ track }),
  });
  if (!segments.ok) throw new Error(`draft save failed: HTTP ${segments.status}`);
  const patched = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: meta.name || null, ...meta.defaults, environment: meta.environment }),
  });
  if (!patched.ok) throw new Error(`draft save failed: HTTP ${patched.status}`);
  return (await patched.json()) as TrackDraft;
};
