# 04 — An eliminated Character is marked, not removed

**What to build:** Elimination that does not disturb the world for everyone still playing.

Per ADR 0042: the Character's entry stays in the collection and its body stays in the world with
its collider disabled, so the simulated set and the iteration order never vary. It is not stepped —
the per-Character work is skipped, so an eliminated Character costs an iteration and a branch, not
a controller sweep.

**This also fixes a live flaw.** M4 ticket 05's disconnect path calls `removeCharacter` mid-Round,
which takes a rigid body out of the world and changes contact resolution for everyone still
racing. It is rare enough that nothing has noticed. Same fix, same ticket.

The client needs almost nothing: it already refuses to mirror players who are down, and eliminated
players go through that same path.

**Blocked by:** 03.

**Status:** blocked

- [ ] An eliminated Character is marked; its body stays, its collider does not
- [ ] It is not stepped, and the saving is real — not a controller sweep per corpse per tick
- [ ] A mid-Round disconnect stops removing the Character from the simulation
- [ ] The client does not mirror eliminated Characters, reusing the down-player path
- [ ] Nobody can shove a corpse, and a corpse cannot shove anybody
