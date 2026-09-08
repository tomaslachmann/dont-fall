# 03 — Live verification

**What to build:** The proof, in real browsers — the only place either half of this milestone can
actually be judged.

**Blocked by:** 01 — A Hit with weight; 02 — Posing the rig from the ragdoll's bones

**Status:** blocked

- [ ] Two browsers: a Hit thrown while committed knocks the other Character down, and both sides see
      it fall in the direction it was actually thrown
- [ ] Two browsers: a Hit thrown from a standstill plays `HitReact` and Staggers, and does not knock
      down
- [ ] The same Character knocked down repeatedly from different angles falls differently each time —
      the whole point of the milestone, and not something a unit test can assert
- [ ] Get-up reads cleanly: settled pose → standing → `Idle`, with no pop
- [ ] 12 connected Characters with several down at once, frame rate holding (ADR 0046's perf
      commitment, now with eleven bones posed per rig per frame behind it)
- [ ] A Survival Round played for real: a knockdown near an edge is close to a kill, and this is
      where the Hit ceiling from ticket 01 either feels right or gets tuned
