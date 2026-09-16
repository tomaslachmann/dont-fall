# 05 — Live verification: two browsers, one Spring

**What to build:** nothing. Run it, with real processes, and write down what
broke.

**Blocked by:** 01–04.

**Status:** planned.

> Why this ticket exists: M6 and M6.1 both left their verification tickets
> unfinished, and the bug that reached the player (`Ragdoll.activate` firing an
> impulse at a body Rapier had given no mass) was one a real browser would have
> shown in seconds. A Spring is exactly that shape of feature — every suite can
> pass while nobody visibly moves.

## What to check

- [ ] Track builder: place a `kaykit_spring`, set `HIGH`, then an exact 7.5 m,
      see the arc redraw, save.
- [ ] Two browsers against one never-restarted Match server: both Players run
      onto the Spring.
  - [ ] Both see **their own** Character launch, and **each other's**.
  - [ ] The squash plays on the Spring that fired — for the launching Player
        and for the watching one.
  - [ ] Height matches what the builder promised (land back on the same deck
        and eyeball against a known-height piece).
  - [ ] Running on keeps the run — you travel forward, not straight up.
  - [ ] Nobody knocks down, nobody desyncs (watch for a correction snap right
        after the launch).
- [ ] A tilted Spring throws at an angle, over a gap.
- [ ] Repeat launches on one Spring: no scale drift, no stuck squash.
- [ ] Two Players hitting one Spring on the same tick: one squash.
- [ ] A Spring on a Moving Segment: the builder's warning shows; the launch
      fires from the rest pose (documented, not a surprise).
- [ ] Free-roam (`?freeroam=1`) shows the same behaviour as a real Match — the
      shared step is the authority in both.
