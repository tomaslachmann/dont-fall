# 09 — Track validation at save/generate + `GET /tracks` list + Browse UI

**What to build:** track-service rejects a save/generate whose Segments reference an unknown
`moduleId` (structural validation — today only the JSON shape is checked, so a garbage Track saves
fine and only blows up when the Match server tries to run it). Add `GET /tracks` (list: id, name,
author, createdAt) since fetch-by-known-id-only stops being a real sharing mechanism once there
are multiple user-created Tracks; the builder gets a "Browse" panel listing existing Tracks
instead of requiring a typed-in ID.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] track-service (`validate.ts`'s `unknownModuleIds`) validates every `Segment.moduleId`
      against `MODULE_LIBRARY` at save time; rejects with a 400 naming the bad id(s). Not applied
      to `/tracks/generate` — it only ever picks ids from `MODULE_LIBRARY` itself, so it's valid
      by construction; validating there too would be pure ceremony
- [x] `GET /tracks` returns every stored Track's id/name/createdAt (not the full Segment data). No
      `author` field yet — that's ticket 10's Revision/authorId work, not this ticket's
- [x] Track builder has a "Browse" panel (`api.ts`'s `listTracks`): lists existing Tracks by name
      + id, clicking one loads it; manual ID entry (`Load` button) stays as a fallback
- [x] Manually verified live (both a running process via curl, and a real browser via Playwright):
      a bogus `moduleId` save is rejected with the id named in the error; saved a second named
      Track, opened Browse, saw both (newest first), clicked the M1 entry and confirmed it loaded
      (6 Segments) and the panel closed. Zero console errors
