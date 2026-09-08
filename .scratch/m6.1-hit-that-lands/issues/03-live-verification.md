# 03 — Live verification

**What to build:** The proof, in real browsers — the only place any of this milestone can actually
be judged.

**Blocked by:** 01 — A Hit with weight; 02 — Posing the rig from the ragdoll's bones; 04 — Hold-to-charge
and Dash locks everything; 05 — Grab's arm-reach

**Status:** ready-for-agent (01, 02, 04, 05 have landed in code; none live-verified yet)

- [ ] Two browsers: a fully-charged Hit knocks the other Character down, and both sides see it fall
      in the direction it was actually thrown (ticket 01's own design, now driven by hold duration
      per ticket 04, not approach speed)
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
