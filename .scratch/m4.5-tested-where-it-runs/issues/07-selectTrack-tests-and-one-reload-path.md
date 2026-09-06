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

**Status:** ready-for-agent

- [ ] Tests for the host-only gate, the LOBBY-only gate, the post-`await` re-check, and the swap
- [ ] The two reload paths share one implementation, including the `serverTick` reset the
      Playtest path learned the hard way
- [ ] The existing Playtest tests still pass unchanged — they are the specification of the shared path
