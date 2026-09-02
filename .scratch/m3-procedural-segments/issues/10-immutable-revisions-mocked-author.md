# 10 — Track publishing: immutable Revisions + mocked `authorId` + contentHash

**What to build:** Per ADR 0032, publishing a Draft creates a new, immutable, numbered Revision of
a Track instead of upserting in place. Every Revision is stamped with a single hardcoded
`DEFAULT_AUTHOR_ID` (deliberately, visibly mocked — no real Account system exists yet, ADR 0024)
and a `contentHash` (canonical JSON hash) so its exact content is independently verifiable.

**Blocked by:** 09 (extends the same save/publish path validation just landed on).

**Status:** done

- [x] track-service schema: `(track_id, revision)` composite primary key (not `track_id` alone),
      plus `content_hash` and `author_id` — a publish is always an `INSERT`, never an `UPDATE`
- [x] `POST /tracks` with an explicit `id` in the body republishes that `trackId` as Revision N+1;
      omitting `id` creates a fresh `trackId` at Revision 1. Revision numbers are computed from
      `MAX(revision) WHERE track_id = ?`, never reused
- [x] `authorId` is a single exported `DEFAULT_AUTHOR_ID` (`"local-author"`) constant, stamped on
      every Revision
- [x] `GET /tracks/:id` and `GET /tracks/any` return the latest Revision for that `trackId`;
      `GET /tracks` (ticket 09's list) dedupes to one row per `trackId`, showing only the latest
- [x] Manually verified live (real process + real SQLite, and integration tests): published a
      Track, republished the same id with different content, confirmed Revision 2 exists,
      `authorId`/`contentHash` are present, and the list endpoint shows only the latest name/
      content per `trackId`, not one row per Revision
