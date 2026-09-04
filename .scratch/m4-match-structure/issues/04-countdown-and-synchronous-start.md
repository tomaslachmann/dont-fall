# 04 — Countdown, and a start both Players share

**What to build:** Two connected Players stop simply existing in a world and instead *start a Round
together*: Characters spawn at their own offsets, input is locked, cameras are live, an overlay
counts three seconds down from the server's Tick, and at zero everyone is released in the same Tick
with nobody teleporting into place.

**Blocked by:** None — the start can be triggered by two clients being connected; the Lobby that
eventually triggers it is ticket 07.

**Status:** ready-for-agent

- [ ] The server owns a Match phase and every transition from Countdown onward; the phase rides the
      Snapshot and clients render it rather than computing it (ADR 0040)
- [ ] Countdown is 3 s derived from the server Tick, not from any client's wall clock
- [ ] Characters are spawned before the Countdown, at offsets derived from join order, with input
      locked and cameras live — so the start is synchronous and nothing jumps at zero
- [ ] The client shows a Countdown overlay driven by the phase and the server clock
- [ ] At zero the phase becomes running and input unlocks for every Character in the same Tick
- [ ] Manually verified live with two browsers: both see the same Countdown, are released together,
      and neither teleports on release
