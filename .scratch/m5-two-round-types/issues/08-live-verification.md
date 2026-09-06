# 08 — Two Round types, two browsers, one server

**What to build:** The proof. Not a test file — the thing running.

Every milestone since M1 has been signed off by playing it, and the ones that found real bugs found
them here rather than in vitest. M5's claim is that two Round types share one engine, and the only
way to believe it is to run both against the same server without restarting it.

**Blocked by:** 01–07.

**Status:** blocked

- [ ] A Race, played by two browsers, behaving exactly as it did in M4 — Countdown, Finish Zone,
      Qualification, the clock, Elimination on expiry
- [ ] A Survival Round on the arena: one Player shoves the other off, the shoved one is eliminated
      and does not respawn, the last one standing Qualifies, the Round ends on the Survivor Target
- [ ] A Survival Round that ends on the clock instead, with everyone still standing Qualifying
- [ ] Both Round types on the same server process, one after the other, with no restart between
- [ ] A mid-Round disconnect during Survival: recorded, and the world unchanged for whoever is left
