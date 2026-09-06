# 07 — Authoring a Survivor Target, and choosing a Round type

**What to build:** The two ends that make Survival reachable by a player rather than by a test.

**Authoring:** the Track builder writes a Track's default Survivor Target, exactly as ticket 03 of
M4 taught it to write the Time Limit — a number on the Draft, written with the Revision, restored
on load. Without it, half of ADR 0041 is unauthorable.

**Choosing:** the Lobby picks the Round type, and the server refuses to start a Round whose Track
cannot support it — a Race needs a Finish Zone. Validated at Round start, never by tagging Tracks
with the Round types they allow (ADR 0041), because that would be a compatibility matrix to
maintain and re-check against every existing Track.

**Blocked by:** 02 (there must be something to author into) and M4 ticket 07's Lobby.

**Status:** blocked

- [ ] The builder authors a default Survivor Target; publish writes it, load restores it
- [ ] The Lobby picks the Round type and shows it to everyone before the start
- [ ] Starting a Race on a Track with no Finish Zone is refused with a reason a player can read —
      replacing today's silent "not raceable"
- [ ] Nothing tags a Track with the Round types it allows
