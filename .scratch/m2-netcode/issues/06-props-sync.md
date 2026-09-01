# 06 — Props sync across clients

**What to build:** Dynamic Props are included in the server's snapshot and appear
consistently on every connected client — mirrored into each client's local world as a
positioned obstacle, the same way the other player's Character already is (ADR 0012). A
Prop the local player is actively pushing responds immediately on that client (locally
simulated for the duration of the push) and is corrected the instant the server's own
resolution of that Prop disagrees — for example, when two players push the same Prop
from different sides.

**Blocked by:** 04.

**Status:** done

- [x] Every Prop's position and orientation is part of the server's broadcast snapshot
      (`SimState.props` — since ticket 02; each `PropSnapshot` carries position + rotation)
- [x] Both clients see every Prop in a consistent position, mirrored from the snapshot
      (rendered from the interpolated server broadcast, not the local sim)
- [x] Pushing a Prop the local player is touching moves it immediately on that client —
      `RapierSimulation.getContactedProps` reports the contact, the client marks the Prop
      locally-live (`PROP_LOCAL_SIM_GRACE_TICKS` of grace) and renders its own simulation
      of it; ~1 tick from first contact to first motion, never a round trip
- [x] If the server's resolution disagrees past `PROP_HARD_CORRECT_DISTANCE`, that
      client's Prop is hard-corrected to the snapshot (`syncPropsToSnapshot`, same policy
      as ADR 0013's Character correction)
- [x] A Prop neither local player is touching is never locally simulated — `Prop.follow`
      pins it to the snapshot pose (inert, zeroed velocity) at the end of every tick;
      only `locallyLiveProps` run under physics. On the server nothing calls the sync
      methods, so every Prop stays fully dynamic and authoritative.

**Accepted M2 approximation:** a pushed Prop starts moving one local tick (~33 ms) after
first contact — the contact is only known after the tick that detected it. Still far
inside a round trip; imperceptible at this game's speed.
