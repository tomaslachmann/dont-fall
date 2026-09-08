# 07 — Spectator Mode

**What to build:** A Player out of a Round follows one still in it, instead of staring at their own
body.

**Blocked by:** ticket 04 (until Rounds run in sequence, being out of one is nearly the end of the
session and the dead time does not bite).

**Status:** blocked

## Why

Since M5 ticket 04 (ADR 0042) an eliminated Character is marked, not removed: its body stays in the
world with its collider disabled, and the camera stays on it. That was tolerable when the Round was
the session. Under ADR 0049 a Player eliminated thirty seconds into Round one of three has minutes
of watching a corpse ahead of them.

`CONTEXT.md` has defined **Spectator Mode** since before any of this, and **Bet** is defined
strictly in terms of it. This is the ticket that makes it exist.

## What to change

- [ ] While eliminated and the Round is still running, the camera follows a Character still in it
- [ ] A key cycles between the living Characters; the choice is the client's own — nothing about
      who you are watching goes to the server or onto the snapshot
- [ ] The follow camera reuses the spring arm the local Character already uses, aimed at somebody
      else, rather than a second camera implementation
- [ ] It ends with the Round, never later — the next Round starts you playing (ADR 0049)
- [ ] Input stays locked, as it already is for an eliminated Character (M5 ticket 01, ADR 0044).
      Spectating must not become a way to send inputs

## Done when

- [ ] The camera never has nobody to follow: the last Character standing in a Survival Round, a
      Round where everyone is eliminated in the same Tick, and a Round with one Player are all
      handled without a frozen or null camera
- [ ] Leaving Spectator Mode at the Round's end hands the camera back cleanly — no leftover offset
      or target from ADR 0026's smoothing
- [ ] **Live:** two browsers, one Player shoved off in a Survival Round, watches the other play out
      the rest of the Round from a following camera, and is playing again in the next Round

## Watch out for

**The spectated Character is a remote one**, interpolated from snapshots (ADR 0025), not predicted.
A camera glued to it will show interpolation that the owning client never sees on itself. Use the
same render-time offset machinery the rest of the remote rendering uses rather than reading raw
snapshot positions.

**Your own body is still lying there** and other Players can still see it. Nothing here removes it —
ADR 0042 is deliberate about that.

**Do not build a free camera.** It was considered and rejected in the grilling session: more code
(controls, collision, bounds) and worse for Bet, where you want to watch a specific Player.
