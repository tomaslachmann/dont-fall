# 04 — Second player: shared world, solid collision, Bump

**What to build:** A second browser client can join the same Match. Each client sees the
other player's Character — interpolated from server snapshots, and solid: neither player
can walk through the other, since each client mirrors the other's Character into its own
local world as a positioned obstacle (ADR 0012). Dashing into the other player delivers a
Knockback through the existing Impact pipeline, scaled by how fast the mover was going: a
fast Dash knocks the other player into Ragdoll, an ordinary walking bump usually doesn't
change their state at all, and only the Character on the receiving end is affected — the
mover keeps their own momentum.

**Blocked by:** 03.

**Status:** done

- [x] Two clients can connect to the same server process and see each other's Characters
- [x] Each client renders the other's Character by interpolating between snapshots,
      using the existing interpolation machinery extended to more than one Character
      (`interpolateState` already handled N; client now draws the non-self ones)
- [x] A Character cannot walk through another Character locally, on either client —
      collision is solid, not just visual overlap (`CHARACTER_GROUPS` now sees
      `GROUP_CHARACTER`; the client mirrors other players as `MirrorCharacter` capsules)
- [x] Character-to-Character contact computes an Impact magnitude from the two
      Characters' relative velocity (`resolveBump`, closing speed × `BUMP_IMPULSE_SCALE`),
      reusing the existing Impact thresholds and `CharacterStateMachine` — no new states
- [x] A fast Dash into another player crosses the Ragdoll threshold and knocks them
      down; an ordinary walking bump usually stays below the Stagger threshold
- [x] Only the Character on the receiving end of a Bump changes state; the moving
      Character is unaffected and keeps moving (gated on the mover's own approach speed)
- [x] Bump is resolved authoritatively on the server only — a client never locally
      decides that another player's Character should change state (a `MirrorCharacter`
      carries no `CharacterController`, so `resolveBump` never targets one)

**Also fixed here:** a latent Rapier bug the second Character exposed — the
kinematic character sweep took no collision-group filter, so it collided against
*everything*, including another player's active ragdoll bones. Now passes
`filterGroups: CHARACTER_GROUPS`.
