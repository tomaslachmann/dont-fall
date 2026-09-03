# 02 — Bounce Surfaces and launch pads

**What to build:** Surfaces that throw a Character into the air — bounce from one to the next across
a gap.

**Blocked by:** 01 — same one-shot latch, established there.

**Status:** blocked

- [ ] Launch velocity is **set**, not added, so it stays idempotent under prediction replay —
      following Quake 3's jump pad, whose launch velocity is precomputed and whose code lives in the
      shared module both client and server run
- [ ] Landing after a launch stays harmless: no fall-damage rule exists today and none is added
      (ADR 0037). What hurts is what a Character hits on the way
- [ ] Leaving the play volume remains the only height-related failure
- [ ] Shortcuts created by launches are a deliberate outcome. Policing them needs a concept of
      finishing a Round, which does not exist until M4 — do not invent one here
- [ ] Manually verified live: bounce from one pad to another across a gap
