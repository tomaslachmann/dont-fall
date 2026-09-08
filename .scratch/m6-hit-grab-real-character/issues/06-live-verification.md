# 06 — Live verification

**What to build:** Confirm the whole of M6 live, in real browsers, at once — real remote
Characters, Hit, and Grab, together, plus the 12-player performance bar ADR 0011 sets.

**Blocked by:** 02 — A real, oriented, animated remote Character; 03 — Hit; 04 — Grab (Hold);
05 — Ragdoll, které drží tvar těla

**Status:** ready-for-agent

- [ ] Two real browsers: one Player Hits another, both see the Impact and the Dash
      cancellation land correctly on the real, correctly-oriented remote model
- [ ] Two real browsers: one Player Grabs another, both see the slow-down on both Characters,
      a successful struggle-free release, and the hold-limit auto-release path
- [ ] 12 real connected Characters render and animate correctly with frame rate holding
      (ADR 0046's perf commitment)
- [ ] Both a Race and a Survival Round exercised live with Hit/Grab, confirming no
      Round-type-specific behavior difference
- [ ] A Character knocked down settles as a body on both sides, and the two sides agree — the
      ragdoll runs in client prediction and server authority alike (ticket 05)
