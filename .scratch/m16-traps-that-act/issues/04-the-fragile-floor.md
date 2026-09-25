# 04 — The fragile floor

**What to build:** A tile that cracks under every new arrival and disappears on
the third, coming back after the author's delay. The first per-Segment state a
Round changes and the Snapshot carries. ADR 0118.

**Blocked by:** 01

**Status:** done on tests (2026-09-21) — every visual and feel check is the user's

- [x] A `fragile` Attachment on the Segment (ADR 0099's registry: its own
      `invalidReason`, its noun, its conflicts — not a Prop, does not move), holding
      the return delay in seconds; `0` means never
- [x] The rule: a Character becoming grounded on the Segment having not been
      grounded on it the Tick before costs one state. Standing costs nothing; two
      arrivals on one Tick cost two
- [x] On the third the collider goes off and the tile is not drawn; a Character on
      it falls. After the delay it returns intact
- [x] The state rides the Snapshot for Segments that are not intact — a small
      integer and a return deadline each — so an untouched Track sends nothing
- [x] The client predicts its **own** Character's entries through the same shared
      rule, so stepping onto a critical tile drops it immediately; another Player's
      entry arrives with the Snapshot and may break the tile retroactively, which
      reconciles into a fall
- [x] The three authored state groups are drawn by visibility; the collider is the
      same box until it is gone, so standing never depends on how cracked it looks
- [x] Authoring: the builder's inspector (a FRAGILE panel with the delay) and an
      MCP setter, plus a Thumbnail-safe rest pose (intact) for previews
- [x] Tests (shared): three entries break it; standing on it does not; a walk-on
      and a landing count alike; it returns after the delay and not before; `0`
      never returns; a reconcile replay does not double-count an entry

## Notes

- No debris in this version (the user, 2026-09-21). The GLB's two loose chips stay
  authored and unused.
- `baseRace.test.ts` and the four authored Tracks must still walk end to end; a
  fragile tile on a Race is the author's risk, and the default delay is what keeps
  a Track finishable for the last Player through.

## As built

- **`FragileFloors`** (`simulation/`) owns the counting, the returns and the switching; the
  floor itself is a body that never moves. `RapierSimulation` feeds it each Character's
  ground contact in the same post-step loop that reads the Surface — the freshest that
  contact ever gets — and settles the floors once, after every Character has moved.
- **The Attachment is the return delay, not the whole mechanic** (see ADR 0118's As built):
  a floor that breaks is a shape, like a Spring and a trap door, so the def says it breaks
  and the Segment says for how long it stays gone.
- **The prediction latch is one number.** Each floor remembers the Tick it last changed on;
  a snapshot older than that leaves it alone. That is what stops a tile the local Character
  just broke from flickering back for a round trip, while another Player's arrivals still
  arrive as the server's word.
- **`SimState.fragile` is absent unless something is broken**, so a Track with no fragile
  floors — every Track there is today — costs the protocol nothing.
- **Found while testing:** a Character that falls through respawns onto the same tile,
  which is an arrival like any other, so a floor is rarely *untouched* again after it has
  been used. The test that expected "nothing to send at all" after a return was wrong, not
  the code.
- **Authoring:** a FRAGILE section in the builder's inspector (return stepper, a hint that
  says what breaks it), `set_fragile` on the MCP server, and the builder draws the intact
  look so a Thumbnail has the piece as placed.
- **Not built:** debris. The GLB's two loose chips stay authored and unused (ADR 0118).
