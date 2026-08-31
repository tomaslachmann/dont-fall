# 0002 — Authoritative dedicated servers, spun up on-demand per Match

From M2 onward, each Match runs on a dedicated Node server instance that holds the
authoritative simulation. Instances are started on-demand for a Match and torn
down when it ends — not a standing fleet.

The core fantasy is physical interaction between Characters (Bump, Knockback,
Grab). That only feels fair and consistent if one authority resolves every
collision. Host-authoritative (one player's browser is the authority) gives the
host an advantage, is cheatable, and drops the Match if the host leaves.
Client-authoritative-with-validation makes Character-vs-Character contact
permanently disputed ("on my screen I shoved you"). On-demand instances keep the
hosting bill proportional to actual play while preserving a true authority.

## Consequences

- There is a real per-Match compute cost and a cold-start latency to design around
  (pre-warm a small pool, or accept a few seconds of lobby time).
- Anti-cheat, matchmaking, and instance orchestration become real work items
  before public multiplayer — deliberately deferred past M2's "2 players" scope.
