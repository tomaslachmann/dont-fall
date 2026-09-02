# 10 — Track publishing: immutable Revisions + mocked `authorId` + contentHash

**What to build:** Per ADR 0032, publishing a Draft creates a new, immutable, numbered Revision of
a Track instead of upserting in place. Every Revision is stamped with a single hardcoded
`DEFAULT_AUTHOR_ID` (deliberately, visibly mocked — no real Account system exists yet, ADR 0024)
and a `contentHash` (canonical JSON hash) so its exact content is independently verifiable.

**Blocked by:** 09 (extends the same save/publish path validation just landed on).

**Status:** ready-for-agent

- [ ] track-service schema gains `revision` (int, scoped per `trackId`) and `contentHash`
- [ ] Publishing the same `trackId` again creates Revision N+1 — never mutates an existing row
- [ ] `authorId` is a single exported `DEFAULT_AUTHOR_ID` constant, stamped on every Revision
- [ ] `GET /tracks/:id` returns the latest published Revision for that `trackId` (exact addressing
      of a specific older Revision is a nice-to-have, not required by this ticket)
- [ ] Manually verified: publish the same Draft twice, confirm two Revisions exist and the latest
      is what `GET /tracks/:id` returns
