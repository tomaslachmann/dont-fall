# 04 — The physical Limp, Spin and Hurl

**What to build:** A Limp body hangs and swings as a real ragdoll from the grabber's grip, and a
Hurl throws it with the velocity the Spin actually gave it — clamped into today's tuned band.
Settled with the user (2026-09-20): physical hang for **Limp + Spin only** (the Struggle keeps its
animated hold — the victim is conscious and fighting), and Hurl speed = **physics clamped to
`[HURL_MIN_SPEED, HURL_MAX_SPEED]`** so the measured balance of ADR 0104 holds.

**Blocked by:** 01, 02

**Status:** planned

- [ ] While the hold's phase is `"limp"`, the victim's ragdoll activates in a held flavour: a
      spherical grip joint at the collar to a kinematic anchor that `GrabHolds.updateGrabs` places
      at the grabber's carry point every tick (the anchor starts exactly on the grip point so
      nothing kicks at the catch). The capsule keeps being hard-placed at the carry point — every
      capsule-level contract in `GrabHolds.test.ts` stays green
- [ ] `MOTION_MODES.Held`'s pose becomes phase-aware: `snapshot()` emits the 15 bones while limp
      (the one consciously flipped assertion: bones-empty-while-Held)
- [ ] Hurl: the grip joint is removed and the body keeps its real orbital velocity; the launch
      rescales the horizontal speed into `[HURL_MIN_SPEED, HURL_MAX_SPEED]`, keeps
      `HURL_LIFT_SPEED`, and the `HURL_AIM_SNAP` steering pull rotates the velocity it clamps.
      Let-go of a Limp body releases with the hang's own velocity; Struggle-phase exits (escape,
      set-down) and the dizzy fling keep their rules
- [ ] Draw: the limp victim is posed from bones (ticket 02's path) — `limpPoseAt`'s held `KO_B`
      frame and the whole of `carriedFlail.ts` retire. On the grabber's own client the bone set is
      re-hung off the drawn grabber exactly as `carriedPose.ts` re-hangs the capsule (offset taken
      in the server's world, rotated by how far the prediction has turned), so the body never
      trails the predicted hands by a round trip
- [ ] Grabber lean (render-only): the bench's damped spring — target `min(cap, ω²R/g·k)` from the
      replicated spin rate, a release kick sized by the vanished centripetal load, on top of the
      existing `decayedSpinMomentum` yaw bleed. Both rigs (local + remote pools)
- [ ] Tests: the limp hang replicates bones and the hang follows the anchor; hurl speed is clamped
      at both ends of the band and grows with the wind-up between them; the swing/flight weapon
      checks and grab immunity untouched; `carriedFlail.test.ts` deleted, `grabAnimation.test.ts`
      limp cases replaced

## Notes

- The flight weapon check (`updateFlights`) already reads the ragdoll root's velocity — it works
  unchanged on the real flight.
- The Spin during a *Struggle* keeps today's carried pose + render flail on the capsule; the
  physical hang begins the moment the phase flips to limp.
