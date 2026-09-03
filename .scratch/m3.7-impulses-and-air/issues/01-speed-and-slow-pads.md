# 01 — Speed pads and slow pads

**What to build:** A pad on the floor that fires once as a Character crosses it, briefly making them
faster (or slower) before fading back. The first latched effect in the project, and the pattern the
rest of this milestone reuses.

**Blocked by:** M3.6 ticket 05 (velocity must persist before anything can be written into it).

**Status:** blocked

- [ ] A speed pad applies a one-shot velocity write **plus** a temporarily raised speed cap that
      fades — SuperTuxKart's zipper model. A pure continuous multiplier was considered and rejected:
      the next tick's cap clips it, so on a short pad it does almost nothing (ADR 0035)
- [ ] A slow pad is the same mechanism with the cap lowered
- [ ] Firing exactly once reuses the project's existing `Epoch` idiom rather than a new mechanism, so
      a wide pad touched across several ticks fires one time and the write is idempotent under
      prediction replay
- [ ] A client corrected mid-effect neither double-fires the pad nor loses it — covered by a
      prediction test
- [ ] One demo Module each, visually identical to existing floor pieces
- [ ] Manually verified live with two browsers
