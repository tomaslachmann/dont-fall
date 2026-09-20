# 05 — Validate and publish

**What to build:** `validate_draft` (round-type-aware per D5: Race wants
start + ordered checkpoints + finish zone; Survival wants arena + survivor
target and no finish requirement) running the publish rule-set plus overlap
detection (`trackOverlaps`) over the draft — structured errors, no writes.
`publish_draft` (`{draftId, id?}`) publishes free per D7: new track id or new
revision of an existing one, no confirmation; invalid drafts are refused
with the validator's errors. Thumbnail stays absent (publish allows none).
ADR 0114.

**Blocked by:** 03

**Status:** planned

- [ ] `validate_draft` with Race/Survival rule sets + overlap report
- [ ] `publish_draft` to new id / new revision; refusal carries validation errors
- [ ] Tests: race missing finish refused; survival ok without finish; overlaps reported; publish round-trips through GET
