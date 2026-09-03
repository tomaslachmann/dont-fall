# 03 — A wall hurts because you were fast, not because you dashed

**What to build:** Any Character moving fast into a wall goes down, whatever gave it the speed. Today
the rule is wired to Dash specifically, so a Character fired into a wall by a launch pad hits it and
feels nothing.

**Blocked by:** 02 — a launch pad is what makes this observable without dashing.

**Status:** blocked

- [ ] The rule is re-expressed as a **speed** threshold rather than "is this Character dashing", so a
      bounce, a launch pad or an updraft all qualify (ADR 0037)
- [ ] Impact magnitude scales with closing speed instead of being a constant — which also fixes
      today's behaviour, where hitting a wall is equally hard however fast you were going
- [ ] A second, parallel rule for launched states is explicitly not added: two rules for one event
      drift apart under tuning, and then neither can be blamed
- [ ] What counts as a wall keeps its existing definition, kept separate from the walkable limit for
      exactly this reason (M3.6 ticket 03)
- [ ] Dashing into a wall feels as it did — Dash is now simply one source of speed among several
- [ ] Manually verified live: a launch pad fires a Character into a wall and knocks it down
