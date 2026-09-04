# 05 — A Round ends, and not everyone makes it

**What to build:** The Round actually finishes. It ends the moment every connected Character has
qualified, or when the clock hits zero — whichever comes first — and anyone who did not reach the
Finish Zone is eliminated. A Player who disconnects mid-Round is recorded as a DNF and does not come
back into a running Round.

**Blocked by:** 02 (Qualification), 03 (the clock), 04 (the phase machine these transitions extend).

**Status:** blocked

- [ ] The Round ends early when every connected Character has qualified, and otherwise when the Time
      Limit reaches zero — both decided by the server, from the same state it already owns (ADR 0040)
- [ ] Everyone not qualified when the Round ends is eliminated. A Fall still never eliminates — it
      only costs time through Respawn (CONTEXT.md)
- [ ] A disconnect removes the Character and records a DNF; there is no mid-Round rejoin
- [ ] The phase advances through round-end into results, carried on the Snapshot like the rest
- [ ] The HUD shows how many have qualified out of how many are connected, and tells an eliminated
      Player that they were eliminated
- [ ] Manually verified live with two browsers, all three endings: both qualify, the clock expires on
      one of them, and one disconnects mid-Round
