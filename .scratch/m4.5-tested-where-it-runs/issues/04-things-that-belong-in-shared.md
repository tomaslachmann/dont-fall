# 04 — Move what belongs in `packages/shared` into it

**What to build:** Two things live in an app that are domain, not app.

- `qualificationPlacement` (`apps/client/src/qualification.ts`) is a Round rule — where you placed
  among everyone who Qualified. It is pure, it is domain, and M4 ticket 08's Results screen wants
  it. `packages/shared/src/match/` already holds `Qualification.ts`.
- `StoredTrack` is declared by hand in track-service and again in the builder — one HTTP response
  shape with hand-written views of it on both sides. `TrackListing` set the precedent by moving to
  shared for exactly this reason; this is the same fix for its sibling.

**Blocked by:** None.

**Status:** ready-for-agent

- [ ] `qualificationPlacement` lives in `shared/match` with its tests; the client imports it
- [ ] `StoredTrack` is declared once in `packages/shared`; track-service and the builder import it
- [ ] No behaviour change; the wire is untouched
