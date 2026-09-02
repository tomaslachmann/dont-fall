# 09 — Track validation at save/generate + `GET /tracks` list + Browse UI

**What to build:** track-service rejects a save/generate whose Segments reference an unknown
`moduleId` (structural validation — today only the JSON shape is checked, so a garbage Track saves
fine and only blows up when the Match server tries to run it). Add `GET /tracks` (list: id, name,
author, createdAt) since fetch-by-known-id-only stops being a real sharing mechanism once there
are multiple user-created Tracks; the builder gets a "Browse" panel listing existing Tracks
instead of requiring a typed-in ID.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] track-service validates every `Segment.moduleId` against the real Module library at
      save/generate time; rejects with a clear 400 error naming the bad id(s)
- [ ] `GET /tracks` returns every stored Track's id/name/author/createdAt (not the full Segment
      data — keep the list payload small)
- [ ] Track builder has a "Browse" view/panel: lists existing Tracks by name, clicking one loads it
      (replacing manual ID entry as the primary path; direct-by-id load can stay as a fallback)
- [ ] Manually verified: attempt to save a Track with a bogus `moduleId` and confirm it's rejected;
      save two named Tracks and confirm both appear in Browse
