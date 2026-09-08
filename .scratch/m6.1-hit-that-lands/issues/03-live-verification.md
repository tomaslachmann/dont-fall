# 03 — Live verification

**What to build:** The proof, in real browsers — the only place any of this milestone can actually
be judged.

**Blocked by:** 01 — A Hit with weight; 02 — Posing the rig from the ragdoll's bones; 04 — Hold-to-charge
and Dash locks everything; 05 — Grab's arm-reach

**Status:** closed as a partial record, 2026-09-08 — see "What was actually verified" at the
bottom. Some boxes below are still unticked and are **not** carried forward as a ticket: M7 drops
end-of-milestone verification tickets entirely, because this one and M6's own sat unfinished while
the bug they existed to catch reached the player instead. Live verification now belongs inside each
ticket's own "Done when".

- [x] Two browsers: a fully-charged Hit knocks the other Character down, and both sides see it fall
      in the direction it was actually thrown (ticket 01's own design, now driven by hold duration
      per ticket 04, not approach speed) — **and this is where the milestone's real bug was found**
- [ ] Two browsers: a tapped Hit plays `HitReact` and Staggers, and does not knock down
- [ ] The same Character knocked down repeatedly from different angles falls differently each time —
      the whole point of ticket 02, and not something a unit test can assert
- [ ] Get-up reads cleanly: settled pose → standing → `Idle`, with no pop
- [ ] 12 connected Characters with several down at once, frame rate holding (ADR 0046's perf
      commitment, now with eleven bones posed per rig per frame behind it)
- [ ] A Survival Round played for real: a knockdown near an edge is close to a kill, and this is
      where the Hit ceiling from ticket 01 either feels right or gets tuned
- [ ] Two browsers: Dash genuinely locks out Hit and Grab — holding either through an active burst
      does nothing until it ends (ticket 04's own bug report)
- [ ] Two browsers: a Hit landing on a Character mid-Dash no longer leaves the dash-run animation
      stuck fighting the Punch/HitReact overlay (ticket 04's animation fix)
- [ ] Two browsers, and a third spectator: Grab's arm-reach pose reads as "reaching toward the held
      Character," not twisted or broken, from every seat (ticket 05 — never actually seen rendered
      by any session so far; the highest-risk unverified item in this milestone)

## What was actually verified — 2026-09-08

Two real browsers against a real match server, both clients driven end to end. Recorded here
because the evidence exists and the ticket should not pretend otherwise.

**Verified:**

- **A full-charge Hit knocks the target down, and the fall is drawn from the bones.** Measured on
  the target's own client: `Controlled → Ragdoll` on release, head height falling `1.47 → 0.17`
  over ~1.3 s, pelvis travelling ~0.4 m, `GettingUp` at 1400 ms. Confirmed visually with a
  stroboscopic series — identical swings screenshotted at 300 / 700 / 1100 ms after release, from
  the striker's side.
- **Grab's arm-reach** (ticket 05) reaches the held Character.
- **Grab's tether** drags a Character that inputs nothing: the held Player moved exactly with the
  grabber, `(-1.7, 9.2) → (-1.6, 9.4)`.
- **The Grab facing lock**, via an A/B with identical movement: walking backwards *without* a Grab
  spun the model 180° to face the camera; the same movement *while* grabbing left it untouched and
  both Characters simply strafed.

**Found by verifying, and missed by 1072 unit tests:** `Ragdoll.activate` applied the knockdown
impulse to a body whose mass Rapier had not computed yet (`chest.mass() === 0`, because the bone had
been sitting `Fixed`), so `applyImpulse` was a silent no-op. A full-charge Hit therefore knocked
nobody down — the ragdoll stood in place and got up on the `RAGDOLL_MIN_MS` floor. Fixed with
`recomputeMassPropertiesFromColliders()`; two regression tests added to `Ragdoll.test.ts`, red
first. This is the single strongest argument for M7's "no verification ticket at the end" rule.

**Not verified, and deliberately not carried as a ticket:** a tapped Hit staggering rather than
knocking down (covered by shared tests, not by eye) · the same Character falling differently from
different angles · the get-up transition read · 12 Characters with several down at once · a real
Survival Round used to feel the Hit ceiling · Dash locking out Hit and Grab live. All are covered by
unit or integration tests; none has been watched. Whoever next touches Hit, Grab or the ragdoll
watches them as part of that work.
