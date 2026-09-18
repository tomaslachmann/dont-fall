# 03 — Limp, release and Grab immunity

**What to build:** A Held Character that loses its Struggle, or was grabbed already down, goes
Limp: carried with no input and no get-up clock, for the grabber's carry window. Released, it goes
into an ordinary Ragdoll with a fresh clock. Nobody can be grabbed again straight after a hold.
ADR 0104, "A hold has three phases".

**Blocked by:** 02

**Status:** done on tests (2026-09-18) — every live check is the user's

- [x] Losing the Struggle turns the hold Limp (a phase of `Held`, not the `Ragdoll` state) for
      `GRAB_CARRY_MS`. The body keeps its place at the carry point and gets a limp pose, not a
      physics ragdoll
- [x] Grabbing a Character that is down (Ragdoll or GettingUp) goes straight to Limp. Its running
      knockdown ends there: nothing gets up while Limp
- [x] Release rules: a Limp Character goes into Ragdoll with a fresh clock (`RAGDOLL_MIN..MAX` then
      GettingUp), starting from the carry point with the grabber's velocity. One released during
      its Struggle without a Hurl lands on its feet, Staggering
- [x] What releases: the carry window ending, a let-go (G), the grabber going down, either one
      leaving the Match. Each starts the grabber's cooldown
- [x] Grab immunity: whoever was held cannot be grabbed until `GRAB_IMMUNITY_MS` after it is
      standing (`Controlled`) again, whatever ended the hold. Someone knocked down by something
      other than a hold can still be picked up
- [x] The HUD's Limp text needs the phase on the snapshot (it is already there from 02's phase field)
- [x] Tests (shared): lost Struggle → Limp; downed target → Limp; no get-up while Limp; each
      release path's outcome; a fresh ragdoll clock after release; immunity blocks a re-grab and
      then lapses; worst case bounded (Struggle + carry + one knockdown)
