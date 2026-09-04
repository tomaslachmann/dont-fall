# 01 — Playtest opens the real apps/client + apps/server, not a local bean

**What to build:** Track Builder's "Playtest" button currently spins up its own local-only Three.js
scene + `RapierSimulation` (`playtest.ts`) — no networking, fixed non-camera-relative controls, no
HUD. Replace it entirely: publish the in-progress Track and open the real `apps/client`, connected to
the real `apps/server`, so a developer tests through the exact render/prediction/network pipeline a
player uses.

**Design settled via a `/grilling` session (2026-09)** — see the session transcript for the full
question-by-question resolution. Key decisions:

- The in-progress (possibly never-`Save`d) Track is republished to track-service under one fixed,
  reserved id (`track-builder-playtest`) every click — ADR 0032's Revision model means this never
  clutters the real Browse list (`GET /tracks` only ever lists a distinct id's latest Revision).
- `apps/server` — normally fetches one Track once at boot and never again — gains a live-reload
  capability keyed off a connecting client's own `?track=<id>` query param. Absent for an ordinary
  player, whose connection is completely unaffected.
- If the requested Track differs from what's currently loaded and the server already has players
  connected, the connection is refused with a clear reason rather than silently swapping the Track
  under them — this server has no concept of separate concurrent Matches yet (M4's job).
- Opens in a new browser tab (builder stays open, editable, ready for the next iteration).
- The old local-only `playtest.ts`/`keyboard.ts` are deleted outright — one "Playtest" button, and it
  always means the real thing.
- No new multiplayer orchestration: a second player is still just a second browser tab, opened by
  hand.

**Status:** done

- [x] Track Builder publishes `history.track` to track-service under a fixed reserved id
      (`PLAYTEST_TRACK_ID`) and opens `apps/client` in a new tab at `?track=<id>`
- [x] `apps/client` reads `?track=` off its own URL and forwards it onto its WebSocket connection URL
- [x] `apps/server` reloads its Track (re-fetches by id, rebuilds `RapierSimulation`) when a connecting
      client's `?track=` names something different from what's currently loaded
- [x] A mismatched `?track=` while players are already connected is refused with a clear close reason,
      never silently applied
- [x] The old `playtest.ts`/`keyboard.ts` local-only preview scene is deleted entirely
- [x] Manually verified live: a real browser click on Playtest opened a new tab, the real client
      connected to the real server, and the server was genuinely running the just-published Track

## Implementation notes

**`apps/track-builder/src/api.ts`**: `PLAYTEST_TRACK_ID` (a fixed, human-readable, non-UUID string —
`track-service`'s `saveTrack` treats `id` as an opaque string, no format validation) and
`publishPlaytestTrack(baseUrl, track)`, a POST to `/tracks` with that id — republishing under the same
id every time, which `saveTrack` treats as a new Revision of the same track (ADR 0032), never a new
row.

**`apps/track-builder/src/main.ts`**: the whole `mode: "edit" | "playtest"` state machine is gone —
with no more local playtest scene to toggle into, every `if (mode !== "edit") return` guard was dead
weight, removed along with `mode`/`playtest`/`editCanvas`. The Playtest button handler is now a single
fire-and-forget action: publish, then `window.open` a new tab at
`http://<hostname>:5173/?track=<id>` — 5173 is `apps/client`'s own fixed dev port (hardcoded, not a
shared constant like the server/track-service ports, since it's Vite's own local-dev config, not a
runtime network protocol detail).

**`apps/client/src/main.ts`**: reads `?track=` off `location.search` and, if present, sets it as a
query param on the WebSocket URL it already constructs. The bootstrap's `onClose` handler now also
surfaces `event.reason` in its thrown error — previously a generic "closed before welcome arrived" —
so a server-side refusal reads clearly in the HUD's own failure text instead of a mystery close.

**`apps/server/src/index.ts`**: `fetched`/`simulation` become `let` instead of `const` — the one thing
that never used to change after boot. `fetchTrack` gains an optional `trackId`, fetching `/tracks/:id`
instead of `/tracks/any`. The `wss.on("connection", ...)` handler is wrapped in an async IIFE; before
any of the existing per-connection setup, it reads `?track=` off the raw request URL and, if present:
fetches that id (always, not gated on an id-only comparison — see Code review below), compares against
what's currently loaded (id **and** Revision), and if different, refuses (players already connected)
or rebuilds `simulation` in place (no players connected) before proceeding with the connection exactly
as before.

## Code review

Reviewed at **high** effort (CLAUDE.md's rule for intricate netcode logic). Four findings, three fixed
and one documented as an accepted limitation:

- **Fixed — stale-Revision skip.** The original check compared only `requestedTrackId !== fetched.id`.
  Since Playtest always republishes to the *same* fixed id, every click after the first would see
  `requestedTrackId === fetched.id` and skip the reload entirely — silently serving the first-ever
  Revision forever, defeating the whole point of iterative "edit, Playtest, edit, Playtest" testing.
  Fixed by always re-fetching by id and comparing id **and** Revision, so a fresh Revision under the
  same id is correctly detected as a real change.
- **Fixed — a check-then-act race.** The `sockets.size > 0` occupancy check ran *before* the `await
  fetchTrack(...)`, so an ordinary player connecting while a Playtest reload was in flight could
  register on the pre-reload `simulation`, which the reload then silently replaced out from under
  them — their Character permanently missing from every future snapshot, no error anywhere. Fixed by
  moving the occupancy check to immediately before the synchronous mutation (right after the `await`
  resolves) — since everything from that check through the reassignment is synchronous, the event loop
  cannot interleave another connection's handler in between, closing the race by construction rather
  than with an explicit lock. Also closes the narrower case of two genuinely concurrent mismatched
  `?track=` requests: whichever's fetch resolves first completes its entire synchronous setup
  (including registering itself in `sockets`) before the second's occupancy check ever runs, so the
  second correctly refuses instead of racing.
- **Fixed — surrogate-pair truncation.** `truncateForCloseReason` trimmed one UTF-16 code unit at a
  time to stay under the close-reason's 123-byte cap, which could cut a surrogate pair in half and
  re-encode as a replacement character. Fixed by trimming whole Unicode code points instead
  (`Array.from(reason)`).
- **Documented, not fixed — a WASM memory leak on repeated reload.** `RapierSimulation` has no
  `dispose()`/`free()` of its own; each reload's discarded instance leaks its Rapier WASM `World`'s
  native memory. Giving the whole class a real disposal lifecycle is a bigger, cross-cutting change
  this local-only dev tool doesn't warrant on its own — flagged as a known, accepted limitation in a
  comment at the reload site rather than fixed here.

Two new regression tests added directly from the findings: a same-id-different-Revision reload, and a
genuinely concurrent pair of mismatched `?track=` connections (exactly one welcomed, exactly one
refused).

## Manual verification (real browser)

Ran the full stack locally (track-service, `apps/server`, `apps/client`, `apps/track-builder`, each its
own dev process) and drove `apps/track-builder` with headless Chrome over raw CDP:

- Placed one Module in the builder, then dispatched a **real** mouse click (`Input.dispatchMouseEvent`
  at the button's own coordinates) on Playtest — a synthetic `element.click()` via `Runtime.evaluate`
  was tried first and silently failed: `window.open()` requires a trusted user gesture, which a
  script-driven `.click()` does not count as.
- Confirmed a new tab opened at `http://localhost:5173/?track=track-builder-playtest`, and that the
  real client connected, fetched that exact Track, and rendered it — the HUD showed live tick/render
  stats and genuine prediction/reconciliation numbers, and a screenshot showed the real Character
  model in the real scene.
- Directly opened a second raw WebSocket connection (bypassing the browser) with a *different*
  `?track=` while the Playtest tab was still connected, and confirmed the real running server refused
  it with the expected close code and reason — not just the vitest-spawned ephemeral instance.
- Cleaned up all temporary verification scripts and killed every dev process started for this pass
  afterward.
