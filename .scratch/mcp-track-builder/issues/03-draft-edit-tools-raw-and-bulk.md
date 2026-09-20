# 03 — Draft edit tools, raw and bulk

**What to build:** The authoring core (D2+D4+D11): `create_draft` (from
scratch or `{trackId, revision}`), `get_draft` (segments paged + meta),
`add_segment`/`add_segments`, `update_segment`/`update_segments`,
`remove_segment`/`remove_segments`, `set_draft_meta`, `discard_draft`.
Raw `Segment` JSON throughout — moduleId/position/rotation/pitch/roll/scale
plus attachment fields. Batches are atomic (all-or-nothing per call).
Indices address the draft's segment order; out-of-range is a clean tool
error naming the draft size. ADR 0114.

**Blocked by:** 01, 02

**Status:** planned

- [ ] Draft lifecycle tools over the ticket-01 endpoints
- [ ] Single + bulk segment add/update/remove, atomic batches, index errors
- [ ] `get_draft` paging (offset/limit over segments) + meta block
- [ ] Tests: build a 100-segment draft in bulks; partial batch rolls back
