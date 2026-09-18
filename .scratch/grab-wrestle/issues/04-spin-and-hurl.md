# 04 — Spin and Hurl

**What to build:** While holding someone, holding Hit Spins the grabber in place, winding up.
Letting go Hurls the held Character away as a knockdown, further the faster the Spin was. Spinning
too long makes the grabber dizzy. ADR 0104, "Spin and Hurl".

**Blocked by:** 01 (and 03 for Hurling a Limp body)

**Status:** done on tests (2026-09-18) — every live check is the user's

- [x] Hit held while holding, in either phase, starts a Spin. The grabber is rooted and its angular
      speed ramps to `SPIN_MAX_SPEED` over `SPIN_WINDUP_MS`. The Spin angle is a pure function of
      the Spin's ticks, predicted on the grabber's client and replicated as `facing`. The client
      body follows it, and carries on turning from it after the Spin
- [x] Releasing Hit Hurls: the held Character goes into Ragdoll (new `RagdollCause` `"Hurl"`, added
      to `THROWING_RAGDOLL_CAUSES`), launched along the circle's tangent. It snaps onto the
      grabber's held `moveDirection` if that is within `HURL_AIM_SNAP_DEG`. Power scales with the
      wind-up
- [x] The Hurl's launch is measured, not guessed, as ADR 0093 did for `KNOCKDOWN_LAUNCH_SCALE`:
      distance at a flick, half and full Spin, recorded on the constant: 3 and 10 u/s throw 3.1 u
      and 7.3 u (5 and 11 threw 4.2 and 8.2 — a flick out-throwing a full Hit)
- [x] Overspin: holding Hit for `SPIN_OVERSPIN_MS` past full speed makes the grabber dizzy. The
      held Character flies off weakly in a `slipRoll`-drawn direction, and the grabber goes into
      Ragdoll
- [x] The Held Character winning its Struggle mid-Spin is freed on its feet but flung along the
      tangent with `SPIN_ESCAPE_FLING_FRACTION` of the Spin's speed, as a shove
- [x] Spin wind-up is on the snapshot and in `ReconcileBase` (the HUD's wind-up bar reads it)
- [x] Tests (shared): Spin roots the grabber and ramps; Hurl direction (tangent; snapped within the
      cone; not snapped outside it); power grows with wind-up; overspin → dizzy; escape mid-Spin
      flings; a reconcile replay reproduces the Spin angle
