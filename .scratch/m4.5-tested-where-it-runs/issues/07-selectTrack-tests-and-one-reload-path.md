# 07 — `selectTrack` gets tests, and stops duplicating the reload path

**What to build:** Tests for the newest and least-guarded code in the server, and one reload path
instead of two.

M4 ticket 07's `selectTrack` — the Lobby host choosing a Track — re-implements the Track fetch,
resolve and simulation swap that the Playtest `?track=` path already does, and that path *is*
tested (seven tests, including a regression on the `serverTick` reset that made everyone unable to
move). `selectTrack` has **none**: not the host-only gate, not the LOBBY-only gate, not the re-check
after its `await`, not the simulation swap.

The re-check after the `await` is the interesting one — two hosts, or a host and a phase change,
can race there.

**Blocked by:** None.

**Status:** done

- [x] Tests for the host-only gate ("ignores a Track pick from anyone but the host"), the
      LOBBY-only gate ("ignores a Track pick once the Round has left the Lobby"), the swap ("lets
      the host pick a different Track live, re-seating everyone already connected"), and — the two
      new ones this ticket adds — the post-`await` re-check: "supersedes a still-in-flight
      selectTrack with whichever pick was requested last" (the `selectTrackSeq` guard) and "drops
      a start queued right behind a still-in-flight selectTrack, rather than starting the wrong
      Track"
- [x] The two reload paths already shared one implementation before this ticket
      (`resetToFreshLobby`, M4 ticket 07/08) including the `serverTick` reset. This ticket's own
      race test caught a real gap in it: `resetToFreshLobby` never cleared `startRequested`, so a
      `start` sent right behind a `selectTrack` could be validated against the old Lobby and, once
      the tick loop consumed it, start a Round on the just-swapped-to Track nobody asked to start
      — fixed by clearing `startRequested` in the same shared reset. Not a "moves code" ticket 02
      style change: a real pre-existing bug this ticket's own coverage requirement surfaced,
      fixed where it lives (`resetToFreshLobby`, `apps/server/src/index.ts`)
- [x] The existing Playtest tests still pass unchanged — full server suite green (60 tests, up
      from 58)
