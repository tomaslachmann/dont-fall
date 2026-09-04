# 0032 — Track publishing: immutable Revisions, a mocked `authorId`, no real accounts yet

M3 originally treated every saved Track as directly mutable (`saveTrack` upserts by id). With
user-created Tracks now an explicit goal (2026-09 grilling round) — not just an internal dev tool
— a live Match must never reference a Track that could change out from under it, and there needs
to be *some* notion of authorship even though a real Account/Player identity system doesn't exist
anywhere in the project yet (ADR 0024 defers it; M2's "no accounts, no persistence" and the M4
roadmap don't include it either).

## Decision

- **Publishing a Draft creates a new, numbered, immutable Revision of a Track** (`CONTEXT.md`).
  An existing Revision is never mutated — republishing the same Draft again produces Revision
  N+1, not an overwrite. `contentHash` (canonical JSON hash) makes a Revision's exact content
  independently verifiable, per `docs/track-builder-proposal.md` §15.
- **`authorId` is a single hardcoded constant for now** (e.g. `DEFAULT_AUTHOR_ID`), stamped on
  every Revision — deliberately and visibly mocked, not a placeholder that looks real. When a real
  Account system lands, this becomes a foreign key; nothing about the Revision shape needs to
  change, only what populates the field.
- **A `GET /tracks` list endpoint replaces "you must already know the id."** With multiple
  user-created Tracks now expected, fetch-by-known-id-only isn't a real sharing mechanism — this
  is the minimum needed for the builder to have a "Browse" view. Full search/tags/likes/moderation
  (`docs/track-builder-proposal.md` Phase 8) stays deferred until real accounts exist to moderate
  against.
- **No asset/GLB/CDN pipeline.** Modules stay code-defined (`packages/shared`), not player-
  uploaded meshes — the proposal's §14 pipeline solves untrusted third-party asset content, which
  doesn't exist here: a Draft only ever references known, code-shipped Modules by id.
- **No share-code/lobby-redemption flow.** A Revision is addressable by `trackId` + `revision`
  directly through track-service's existing fetch API — lobbies don't exist before M4, so there is
  nothing yet for a "share code" to be redeemed into.

## Consequences

- track-service's schema gains `revision` (int, per `trackId`) and `contentHash`; a save/publish
  always inserts a new row rather than updating one.
- `GET /tracks` (list) is a new endpoint; `GET /tracks/:id` becomes "latest published Revision for
  this `trackId`" (or is addressed as `trackId@revision` — a ticket-level detail, not an
  architectural fork).
- The Match server's fetch (ADR 0028) is unaffected in shape — it still just asks for a Track and
  gets one back; which Revision it receives is now well-defined (always the latest published) and
  immutable for the Match's whole run, closing a real "Track changes under a live Round" risk that
  didn't exist before user-created content did.
- Revisit this ADR specifically (not silently work around it) once a real Account system lands —
  `authorId` stops being mocked, and per-author Track ownership/permissions likely need their own
  design pass at that point.
