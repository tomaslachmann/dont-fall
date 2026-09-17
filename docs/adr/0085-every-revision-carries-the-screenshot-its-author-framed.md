# 0085 — Every Revision carries the screenshot its author framed

## Context

Discover cards and the Round loader had no art: cards showed generated
stripes, the loader a spinner. The user asked for real map images — captured
in the Track builder just before saving (the bare map, everything on, framed
by the author), then reused as Discover thumbnails and as the loading
screen's full-page art with the map's name big.

## Decision

**A Revision carries one Thumbnail: the JPEG screenshot its author framed
before saving.** Presentation only, like the Environment (ADR 0074) — the
Match server never reads it.

- **Stored per Revision, as the data URL.** A nullable `thumbnail` column on
  the Revision row holds the builder's `data:image/jpeg;base64,…` verbatim —
  no files on disk, no re-encoding, nothing to keep in sync with the row it
  describes. Out of the content hash with the clock and the sky: a re-framed
  screenshot is not new Segments. Pre-Thumbnail rows read NULL, meaning "no
  Thumbnail", with no backfill.
- **Flagged, never inlined.** `TrackListing` and `StoredTrack` carry only
  `hasThumbnail`. The bytes live behind `GET /tracks/:id/thumbnail`
  (latest, or `?revision=`-pinned like the detail read), served as raw JPEG
  so an `<img>` points straight at it. A pinned Revision caches forever (it
  is immutable, ADR 0032); "latest" revalidates in 30 s. A missing Track and
  a thumbnail-less Revision 404 with different messages, so a client can
  tell a bug from a fallback.
- **One shared frame.** 1280×720 JPEG is declared once in `shared`
  (`TRACK_THUMBNAIL_*`), so the builder captures, the API validates (prefix,
  base64 shape, ~1 MB cap), and the clients lay out against the same
  numbers. The API never decodes the JPEG — a Revision is immutable, so a
  malformed upload is refused, never silently fixed.
- **Capture is a mode, not a button.** SAVE opens it: the viewport goes
  fullscreen with the authored Environment drawn, Motions running and Impact
  tints lit, every authoring overlay (selection, guides, course markers,
  panels) hidden, picking disabled — orbit, zoom and pan stay the author's.
  CREATE PREVIEW captures the fixed frame and saves; CANCEL (or Esc) drops
  the stashed save and restores the view. Any failure keeps the framing, so
  the author retries instead of starting over.
- **Every consumer degrades.** Discover falls back to the stripes, the
  loader to the plain surface (the name still shows big), a failed image
  load hides itself. Nothing ever shows a broken-image icon.

## Consequences

- The code-owned seed and playtest Revisions have no Thumbnail and keep the
  fallbacks — a screenshot needs an author framing a viewport.
- The listing stays light: one boolean per row, no JPEG bytes on any JSON
  shape the Match server fetches.
- SAVE on an empty Track is refused up front (like Playtest already was) —
  there is no map to shoot yet.

## Alternatives rejected

- **Files on disk next to the DB.** A second store to back up, sync and
  serve, for bytes that belong to exactly one immutable row. SQLite TEXT
  keeps the Revision self-contained.
- **Bytes inline on the listing/detail.** One JPEG per row would drown the
  catalogue payload and every Match-server Track fetch. A dedicated endpoint
  keeps the hot paths lean.
- **Auto-capture without framing.** A fixed camera (or a headless render)
  needs no UI but frames badly on every non-trivial Track — and "frame it
  yourself" is what makes the art worth showing.
