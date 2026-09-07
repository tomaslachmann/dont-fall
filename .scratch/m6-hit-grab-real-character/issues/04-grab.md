# 04 — Grab (Hold)

**What to build:** Pressing the Grab input latches onto whoever is directly in front of you.
While held, both of you move at a fraction of normal speed and the grabber can't run freely;
the held Player breaks free by moving away, or is automatically released if the grabber holds
on too long. Either Character having a Dash in progress gets cancelled the instant the grab
connects.

**Blocked by:** 01 — Character facing

**Status:** ready-for-agent

- [ ] A new input triggers Grab, on its own cooldown after release, targeting the Character
      directly ahead within range (using replicated facing) — mirrors Hit's own targeting
- [ ] While held, both the grabber and the held Character move at a greatly reduced pace; the
      grabber cannot Dash or otherwise move freely while holding
- [ ] The held Character struggles free by moving away from the grabber for a sustained moment
- [ ] If neither struggling free nor the grabber releasing happens, the grab ends on its own
      after a fixed maximum hold duration
- [ ] Connecting cancels an in-progress Dash for both Characters, exactly like Hit
- [ ] Behaves identically whether the Round is a Race or a Survival Round — no Round-type
      branching
- [ ] Covered by shared-package tests: latching on, the reduced-pace effect on both Characters,
      struggling free, the hold-limit timeout, Dash cancellation for both, cooldown after
      release, and a reconciliation replay that neither double-latches nor double-cancels
