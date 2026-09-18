# 01 — Carried, not towed

**What to build:** A caught Character is lifted and carried at arm's length in front of its
grabber instead of being tethered to it on the ground. While Held its Player's input moves
nothing. The grabber walks and turns slower and can do nothing but carry, Spin (ticket 04) or let
go. ADR 0104, "Being held is a motion state" and "The grabber is loaded".

**Blocked by:** —

**Status:** done on tests (2026-09-18) — every live check is the user's

- [x] `Held` is a new `CharacterMotionState` with its own `MOTION_MODES` row: input scale 0, body
      placed by the hold, not swept by the capsule. Only `GrabHolds` enters and leaves it
- [x] The Held body sits at the carry point: `GRAB_CARRY_DISTANCE` ahead of the grabber's facing,
      `GRAB_CARRY_LIFT` up, pulled in along a shape cast when something is in the way (a spring
      arm, as the camera's). Its capsule collider is off while Held
- [x] The grabber walks at `GRAB_CARRY_SPEED_MULTIPLIER` and cannot Jump, Dash or Hit. The
      tether (`applyGrabTether`, `grabTetherWish`) and `Ragdoll.drag` are gone
- [x] The grabber's facing is no longer frozen. It turns at `GRAB_TURN_SPEED_MULTIPLIER` of ADR
      0085's rate, on the client's body turn, and the server clamps the per-tick change to the
      same maximum. `FACING_TURN_RATE` / `FACING_TURN_SPEED_MAX` move into `tuning/` so both sides
      read them. The Held Character faces its grabber
- [x] The held client enters `Held` from the snapshot and draws its own Character from the server
      while in it, as it does while down (`localDown`)
- [x] The grabber's client reads "I am holding" off the latest snapshot's `grabbingId` into its
      prediction (the slower walk, no Jump/Dash), so the grabber stops rubber-banding after the
      first round trip
- [x] A carried Character is drawn at its grabber's drawn carry point on every client, not at its
      own interpolated position
- [x] A let-go, or the grabber going down, sets a Struggling Character down on its feet at the carry
      point, Staggering (the window itself became the Struggle, ticket 02)
- [x] Tests (shared): catching puts the target in `Held` at the carry point; the carry point pulls
      in against a wall; the grabber's pace and turn clamp; no Jump/Dash/Hit while holding; the
      held Player's input moves nothing; release sets the body down; a reconcile replay does not
      leave `Held` early

## Notes

- `GRAB_SPEED_MULTIPLIER`, `GRAB_DRAG_LEASH` and `GRAB_DRAG_REEL_SPEED` retire here.
- The rig already has `Struggle_Held` / `Struggle_Air` for the Held Character and
  `Grab_Reach → Grab_Pull → Grab_HoldIn` for the grabber (`render/grabAnimation.ts`). The
  struggle loop plays in the air now, because the body is lifted.
- Setting a Held Character down onto nothing (the grabber let go over the void) is a Fall. That is
  the point of carrying someone to an edge in Survival.

## As built

- `isPlayerDrivenMotionState` answers "does its own Player move this body" — false while down or
  Held — for the client's draw path and its mirror obstacles.
- The prediction hears the hold through `RapierSimulation.syncOwnHold(id, ownRow)`, called on every
  snapshot before the reconcile.
- A Held body takes no Impact from anything, and a Hit never targets it (found writing the tests: a
  queued shove fired on release).
- The grabber's own client draws the carried body in its predicted hands (`game/carriedPose.ts`).
- `nextModelYaw`'s `facingLocked` became `turnScale`; `modelYawFromFacing` pins a body the sim turns.
