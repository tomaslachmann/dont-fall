# 0012 — The client's local prediction world mirrors other Characters and Props as positioned obstacles, never simulates their own motion

ADR 0003 says a client predicts only its own Character and interpolates everyone else —
but that describes how remote entities are *drawn*, not whether they exist as physical
obstacles for the local Character's own prediction step. They do: every other Character
and every Prop is placed into the client's local Rapier world each tick, positioned
straight from the latest received snapshot, never locally simulated for their own
motion. The local Character's kinematic-capsule prediction slides against them exactly
like it already does against statics and Spinners — so a player can't locally walk
through another player or through a Prop while waiting for the next correction.

~~The one exception is a Prop the local player is actively pushing: for that duration its
motion *is* locally simulated, so the push feels immediate rather than delayed until the
next snapshot, and it is hard-corrected the instant the server disagrees.~~ **Superseded by
ADR 0016:** that exception is removed — Props are never locally predicted. The
predict-then-hard-correct read as the box jumping backward on release. A pushed Prop is
now, like every other Prop, an obstacle pinned to the interpolated snapshot pose; it moves
only on the server, drawn a beat behind ("heavy box"). The main rule below stands with no
carve-out.

Without this, the core fantasy — "physical chaos and player interaction: bumping,
shoving, and falling" (CLAUDE.md) — would fail exactly where it matters most: a Bump
would visibly do nothing locally for a full round-trip before snapping the mover back,
since there'd be nothing there to bump into yet.

## Consequences

- The local prediction step now depends on receiving reasonably fresh snapshots for
  every other entity, not just running in isolation against static geometry. A stale or
  late snapshot for a remote Character means the local obstacle it presents is stale
  too — an accepted extension of the interpolation-delay tradeoff ADR 0003 already
  prices in for how remote Characters are drawn.
- Knockback/Impact *state changes* from Character-to-Character contact (Bump) are still
  resolved authoritatively on the server only, never predicted locally — this ADR only
  makes other entities solid for movement-blocking purposes, it does not extend
  prediction to their state machines.
