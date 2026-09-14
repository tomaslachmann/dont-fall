# 08 — Ghost UX pass for the enlarged snap set (phase 2, decides Q6)

**What to build:** A prototype answering research open question 6: does the
face/edge/corner/stacking snap set need per-type ghost coloring, or does
priority-order auto-pick with one ghost suffice?

**Blocked by:** ticket 03 (the snap set it presents). Early prototype may
start sooner against mocked snap points — preferred, cheaper.

**Status:** planned

## Why

Q6 is a feel question, not a knowledge question: nobody can tell from a
ticket whether authors get lost among four snap families. The cheapest way to
know is to put both variants in front of hands (yours count) and watch.

## What to change

- [ ] Prototype A: single ghost, priority auto-pick (ticket 03), reason
  string names the winning family ("stacked on…", "edge-aligned…")
- [ ] Prototype B: per-family ghost coloring (e.g. face/edge/corner/stacking
  distinct tints) + the same reason string
- [ ] Test task (same for both): build a small tower (stack 3), a flush
  2×2 floor, and one corner join — time it, count mis-snaps, note confusion
  moments
- [ ] Decision recorded here: A, B, or a hybrid (e.g. single ghost + family
  named in the reason string turns out to be enough)

## Done when

- [ ] Decision + the observations behind it written in this file; winner
  implemented for real (that implementation is part of this ticket, not a
  new one)
- [ ] If A wins: no new rendering code paths — the reason string was already
  ticket 03's work

## Watch out for

**Don't gold-plate the loser.** The losing prototype gets deleted, not kept
behind a setting. Two ghost systems is twice the maintenance for a question
already answered.
