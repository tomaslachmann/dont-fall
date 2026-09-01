# 06 — Props sync across clients

**What to build:** Dynamic Props are included in the server's snapshot and appear
consistently on every connected client — mirrored into each client's local world as a
positioned obstacle, the same way the other player's Character already is (ADR 0012). A
Prop the local player is actively pushing responds immediately on that client (locally
simulated for the duration of the push) and is corrected the instant the server's own
resolution of that Prop disagrees — for example, when two players push the same Prop
from different sides.

**Blocked by:** 04.

**Status:** ready-for-agent

- [ ] Every Prop's position and orientation is part of the server's broadcast snapshot
- [ ] Both clients see every Prop in a consistent position, mirrored from the snapshot
- [ ] Pushing a Prop the local player is touching moves it immediately on that client,
      without waiting for a server round-trip
- [ ] If the server's resolution of a Prop's position disagrees with what a client
      predicted for it (e.g. another player also pushed it), that client's view of the
      Prop is corrected to match the server
- [ ] A Prop neither player is touching is never locally simulated — it only ever
      follows the server's snapshot
