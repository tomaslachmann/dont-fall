# 03 — Sliding down a ramp too steep to walk

**What to build:** The band between "walk up it" and "it's a wall". Today the physics engine's two
slope limits sit at the same angle, so a Character walks anything up to 45° with full control and
treats anything steeper as an unclimbable wall — there is no angle at which it slides.

**Blocked by:** 02 — a Character that skips down ramps cannot be observed sliding down one.

**Status:** blocked

- [ ] Two explicit, independent thresholds — walkable → sliding → wall — replacing the engine's
      coincident defaults. The existing "what counts as a wall" constant keeps its meaning and is
      deliberately not reused as the walkable limit (ADR 0037)
- [ ] A new `Sliding` Character state, held by a **condition** (grounded on a too-steep Surface),
      not by a timer. Reusing `Stagger` is rejected: it means "recovering from a hit", is fixed-
      length, and reusing it would make a slope indistinguishable from a punch in state, animation
      and replication
- [ ] Reduced movement input while `Sliding`; gravity projected along the slope plane applies here
      and only here — ADR 0035 rejects that model for walking
- [ ] `Sliding` applies only while grounded: flying over a steep face keeps full air control, because
      taking control away mid-air for a reason the player cannot see reads as a bug
- [ ] An Impact while `Sliding` sends the Character straight to `Ragdoll`, exactly as from `Stagger`
- [ ] The client derives `Sliding` from the same resolved Track the server has, so prediction agrees
      without new messages — covered by a prediction test, not merely asserted
- [ ] Manually verified live: walk up a shallow ramp, walk onto a steep one and slide down it, and get
      bumped while sliding and go down
