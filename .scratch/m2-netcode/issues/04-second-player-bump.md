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

**Status:** ready-for-agent

- [ ] Two clients can connect to the same server process and see each other's Characters
- [ ] Each client renders the other's Character by interpolating between snapshots,
      using the existing interpolation machinery extended to more than one Character
- [ ] A Character cannot walk through another Character locally, on either client —
      collision is solid, not just visual overlap
- [ ] Character-to-Character contact computes an Impact magnitude from the two
      Characters' relative velocity, reusing the existing Impact thresholds and
      `CharacterStateMachine` — no new states
- [ ] A fast Dash into another player crosses the Ragdoll threshold and knocks them
      down; an ordinary walking bump usually stays below the Stagger threshold
- [ ] Only the Character on the receiving end of a Bump changes state; the moving
      Character is unaffected and keeps moving
- [ ] Bump is resolved authoritatively on the server only — a client never locally
      decides that another player's Character should change state
