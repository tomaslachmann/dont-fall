# 07 — Free the word `Volume`

**What to build:** A Checkpoint's detection region stops being called a volume, so that `Volume` can
mean what CONTEXT.md now says it means: a region that applies a force.

Worth landing before M3.7 introduces the second meaning, rather than after.

**Blocked by:** None — can start immediately, independent of everything else in this milestone.

**Status:** ready-for-agent

- [ ] A Checkpoint's region is renamed to a trigger, across shared code, the server, the client and
      the Track builder — including the doc comment, which already calls it "a trigger volume"
      (ADR 0036)
- [ ] It is part of the Module authoring shape, so confirm whether any published Revision serialises
      it; if it does, accept the old key on read rather than breaking existing content
- [ ] No behaviour changes — Checkpoints activate exactly as before
