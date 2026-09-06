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

**Status:** ready-for-agent

- [ ] One arena Module: an open platform over the void, no walls
- [ ] It carries no Finish Zone and no Checkpoints, and resolves cleanly without them
- [ ] It appears in the builder palette like any other Module
