# 03 — Riding a moving Segment

**What to build:** a grounded Character is carried by the moving Segment
under its feet (its full rigid displacement — a carousel carries it round)
and keeps that velocity when it leaves. Facing stays the Player's (ADR 0045).

**Blocked by:** 02.

**Status:** done (2026-09-14) — tests; the live check is the user's.

## What to change

- [x] Ground collider → moving Segment lookup; carry displacement = the body's
      rigid delta between ticks at the feet, swept excluding that body
- [x] Leaving the ground adds the body's point velocity
- [x] Tests: standing still on Slide (up, down, sideways) stays grounded with
      bounded drift over a full period; a carousel carries around its pivot;
      a jump off a moving platform inherits its velocity
- [ ] Live check (the user's): ride a platform through the real client; prediction holds (no
      reconciliation snaps while riding)

## Notes

- Rapier's kinematic friction carried intermittently (contact-dependent) and
  doubled a Ride; Moving Segment bodies are `Fixed` during the sweeps (ADR 0061).
- A reconcile clears the ground handle; `rideFor` probes straight down for a
  Moving Segment so a correction mid-Ride does not skip a carry and mispredict
  again (covered by the reconcile test).
- Rapier's world steps at its default dt (1/60) although the sim ticks at 30 Hz
  — pre-existing, noticed via kinematic velocities reading double; untouched.
