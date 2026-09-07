# 06 — One arena to shove people off

**What to build:** A Module that is a flat platform over a void. That is the whole ticket.

Survival needs somewhere with edges. It does **not** need a new mechanic: the shoving is Bump,
which has worked since M2 and works everywhere. What makes a Track a Survival Track is only that
you can fall off it in every direction — so the smallest honest content is one open platform with
no walls, no bridges, and nothing to hide behind.

Deliberately minimal. Hazards, a shrinking arena and a collapsing floor are a content milestone,
and the collapsing floor in particular has a hard constraint waiting for it (ADR 0043: terrain that
changes during a Round must be a pure function of the Tick, the `Spinner` pattern — never a
server-sent event).

**Blocked by:** None — content, buildable in parallel with 01–05.

**Status:** done

- [x] One arena Module: an open platform over the void, no walls
- [x] It carries no Finish Zone and no Checkpoints, and resolves cleanly without them
- [x] It appears in the builder palette like any other Module

## What the palette checkbox actually took

"Appears in the builder palette like any other Module" was not free. The arena
carries `sockets: []` deliberately — it is dropped on its own by free placement
(ADR 0034), not chained — but the builder's `rechainFrom` called `placeAfter`
for every non-first Segment, and `placeAfter` throws on a missing Socket. So
the palette offered a Module that took the builder down on click for any
non-empty Track: appending it after anything, appending anything after it, and
duplicating it all threw `Module "arena" has no Socket "entry"`.

Fixed in the builder rather than by giving the arena Sockets it has no meaning
for: a pair that cannot chain now keeps its own position, exactly like one the
author placed by hand. That makes socket-less Modules a supported idea rather
than papering over this one — every future standalone piece would have hit the
same crash.
