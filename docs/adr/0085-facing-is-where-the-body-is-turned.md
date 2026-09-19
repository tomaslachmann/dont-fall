# 0085 — Facing is where the body is turned

> **Amended by ADR 0104 (2026-09-18):** a Grab hold no longer freezes the
> grabber's facing — it turns at a reduced rate the server also enforces, and a
> Spin drives it. The held Character faces its grabber.

## Context

Two things the user raised on 2026-09-17:

- **Turning under WASD read as jerky.** The local model turned toward its
  movement direction at a constant 14 rad/s: a quarter turn in 0.11 s, then a
  hard stop.
- **Other players' bodies pointed the wrong way.** Since ADR 0045 the client
  sent its camera's look-yaw as `facing`, and every other client turns that
  Character's rig to it. Your own body, though, turns toward where you run. So
  someone strafing looked, to everyone else, like they were running sideways,
  and someone standing still and looking around spun on the spot. The user's
  call: other players should see the body's actual orientation.

The same field aims Hit and Grab (`findNearestInCone`), so changing what it
means changes where a swing lands.

## Decision

**The client sends where its Character's body is turned as `facing`.** Hit and
Grab aim where the body is turned, as in Fall Guys (the user's choice over
keeping camera aim and adding a second field).

- **One turn, for everything.** `nextModelYaw` turns the local body and
  `facingFromModelYaw` converts it to the `facing` convention (yaw 0 looks down
  −Z). `Stage.characterFacing()` returns it, and both match play and practice
  put it in `SimInputs.facing`. The wire format is unchanged: still one number.
- **The turn eases in to a soft stop.** Each second it covers all but e^−12 of
  the turn left (`FACING_TURN_RATE`), and never faster than 12 rad/s
  (`FACING_TURN_SPEED_MAX`). A quarter turn comes within 10° in about 0.2 s,
  and turning around takes about 0.3 s. Both are tuning values for the user's
  live check.
- **A Grab hold still freezes it.** The locked body stops turning, so the
  facing sent stops too. The server freezes the replicated value over the same
  span, as before.

## Consequences

- Aim now turns at the body's rate. A Hit thrown straight after a change of
  direction goes where the body still faces, which is where the player sees it
  facing.
- Standing still and moving the camera no longer turns the body, so it no
  longer turns the aim either.
- Every other client draws a Character's body where its owner sees it, a
  render delay later, still interpolated along the shortest arc.
- Before its first step a Character faces +Z, where the model starts, and so
  does its aim.
- The local turn is no longer purely cosmetic: it feeds an input the server
  acts on. It still runs at render rate and is sampled into the input once a
  frame, like the rest of the input.

## Alternatives rejected

- **Keep camera aim, replicate the body separately.** It would keep aiming with
  the camera, but it needs a second field on the wire, and the swing would no
  longer go where the body is visibly facing.
- **Derive a remote body's direction from its velocity.** Undefined while
  standing still, and wrong while pushing into a wall or sliding on ice (ADR
  0045 rejected it for the same reasons).

## Amended by ADR 0109 (2026-09-19)

The turn still runs at render rate, but each Tick's input now carries the body's yaw at that Tick's time (eased between the last two samples). The local body yaw is one tracked value (`bodyYaw`), never read back off Euler angles: after a carry's quaternion write, half of all holds used to send the mirrored facing.
