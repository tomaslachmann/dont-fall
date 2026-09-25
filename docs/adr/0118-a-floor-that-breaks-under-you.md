# 0118 — A floor that breaks under you

## Context

`fragile-block.glb` (2026-09-21) is a 2.4 × 2.4 tile, 0.46 tall, authored as
three sibling groups in one file — `State0_Intact`, `State1_Damaged`
(three cracks and an exposed inner face), `State2_Critical` (eight cracks and
two loose chips) — with no animation. Its own extras state the intent:
`break_after_hits: 3`, `after_state_2: "disable collider and spawn debris"`.

Nothing in the game has ever had **per-Segment state that changes during a
Round**. A Segment's Motion is a function of the Tick; a Surface is a
property; a Gate's opening is fixed geometry. This is the first Attachment
whose value at Tick *n* depends on what the Players did before it.

The user's calls on 2026-09-21: every **new entry** onto the tile costs it a
state (a landing and a walk-on count alike; standing still does not), and it
**comes back after a delay the author sets**.

## Decision

**A `fragile` Attachment gives a Segment three states and a return delay.**

- **What costs a state: a Character becoming grounded on that Segment having
  not been grounded on it the Tick before.** Landing from a jump and walking
  across from the next tile are the same event; standing there is not an
  event at all; two Characters arriving on the same Tick cost two states.
- **On the third entry the tile stops being a floor**: its collider goes off
  and it is not drawn. A Character on it at that moment falls, which is the
  whole point.
- **It returns after the author's delay** — a number of seconds in the
  inspector, `0` meaning never. It returns intact, all three states back.
  A Race whose author leaves the default can be finished by the last Player
  through; an arena author who wants the floor eaten sets `0`.
- **No debris in this version.** The tile vanishes with a sound. Loose chips
  are authored in the GLB and can be turned into bodies later without
  changing this decision.

**The state is the server's, and the client predicts its own entries.** The
count per Segment rides the Snapshot (the first Segment state the protocol
carries — one small integer and a return deadline per fragile Segment that is
not intact). The client runs the same rule in its prediction for its own
Character, so stepping onto a critical tile drops it immediately instead of a
round trip later. Another Player's entry only arrives with a Snapshot and can
retroactively break the tile under a Character that already stood there — the
correction is a fall, which is exactly what the Snapshot shows anyway.

## Consequences

- One more replicated per-Segment value, sent only for Segments not in their
  rest state — an untouched Track costs nothing.
- The three authored states are drawn by swapping which group is visible;
  the collider is the same box until it is gone, so what a Character stands on
  never depends on how cracked it looks.
- A fragile Segment refuses the Attachments that would contradict it, through
  the ADR 0099 registry — it is not a Prop and does not move.

## As built

- **The Asset says it breaks; the Segment says for how long.** Written here as a `fragile`
  Attachment that gives a Segment its three states, built the way the Spring's throw and the
  trap door's swing are: the def carries `{entries, returnSeconds}` because the states are
  *drawn* — three authored looks in the GLB — so a piece with no crack art could never be
  one. The Segment's `fragile` Attachment retunes only the return.
- **It is a body of its own**, not part of the world's baked statics: what is baked in
  cannot be switched off later. It never moves, so the body costs nothing but the ability
  to stop existing. `MovingSegment.setSolid` is shared with the trap door.
- **The client keeps what it has predicted since the snapshot.** `FragileFloors` stamps each
  floor with the Tick it last changed on, and a snapshot older than that stamp is ignored
  for that floor. Without it, a tile you put your foot through pops back for a round trip
  and then breaks again; with it, another Player's arrivals still arrive as the server's
  word, because they can only ever be stamped later.
- **Standing still is not an arrival**, and four seconds of it is still one — held by a test,
  because the obvious implementation (count while grounded) eats a floor in a tenth of a
  second.
- **Six seconds is a guess.** The GLB's extras say what breaking does and nothing about
  coming back. It is long enough that breaking a tile under someone matters and short
  enough to leave a Race finishable; `0` (never) is an arena author's choice per Segment.
- **The looks are found by the Asset's own `state` extra**, which the authored file already
  carried, not by node name. The builder always draws the intact one, so a Thumbnail has
  the piece as placed in it.
