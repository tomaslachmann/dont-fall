# 0093 — A Hit shoves, a knockdown throws, and a Grab drags

> **Superseded in part by ADR 0104 (2026-09-18):** the Grab half — the
> full-speed drag, struggling free by walking away, and dragging a body by its
> bones. A Grab is now carried, Struggled against, and ends in a Hurl. The Hit
> and knockdown halves stand.

## Context

From the user, playing Survival on 2026-09-17:

> hit ma druhej charakter trochu posunout a knock out jeste vic, at survival,
> kdyz se snazi charaktery vyhodit z drahy maji nejakou mechaniku
>
> dál grab i na ragdoll a tahnout ve full speed a moznost pustit

Survival is a Round type about being the last one standing on an arena over a
void (M5). Nothing in the game actually let a Player *put* someone over that
edge:

- **A Hit that staggered moved nobody.** An Impact's impulse was only ever
  consumed by `beginRagdoll`, so a connecting swing under `IMPACT_RAGDOLL_MIN`
  left its target standing exactly where it was. It was felt and never seen.
- **A knockdown barely moved anyone either.** The impulse reached only the
  ragdoll's chest, which tumbles it convincingly and carries it almost
  nowhere. A Character knocked down standing still dropped on the spot.
- **A Grab was a mutual stalemate.** Both participants crawled at a tenth of
  walking pace (`GRAB_SPEED_MULTIPLIER = 0.1`, M6's grilling-session
  decision), so neither could take the other anywhere. It could not latch onto
  a knocked-down Character at all, and there was no way to let go on purpose —
  a hold ended on a struggle, a timeout, or a disconnect.

## Decision

**A Hit that stays on its feet shoves.** A staggering Impact now writes a
decaying horizontal knockback plus a small lift. The knockback is its own
contributor to velocity rather than a write into it: the movement model (ADR
0035) recomputes horizontal velocity toward the wish velocity every tick and,
at full grip, reaches it exactly within that same tick, so a shove written
straight into `velocity` is erased before anyone sees it. It is added after
that pipeline and decayed by `IMPACT_KNOCKBACK_DECAY` each tick.

**Only a Hit shoves.** `SHOVING_IMPACT_CAUSES` is `{Hit}` and nothing else. A
Bump and a Moving Segment apply an Impact on *every* tick of contact, and the
knockdown they cause scales with closing speed — shoving the target on the
first light touch pushes it out of the harder contact that was coming. Found
immediately: a Dash into another Player stopped knocking them down at all, and
a spinning bar stopped hitting harder at its rim. A Hit is a single event with
no follow-up to spoil, which is exactly why it is the one that shoves.

**A knockdown another Player caused throws the whole body.** Every bone leaves
at `KNOCKDOWN_LAUNCH_SCALE` × the Impact magnitude, and the chest impulse still
supplies the tumble.

The scale was tuned by measurement the same day, after the first value played
far too strong ("jedna rana ukoncila survivor" — one hit ended a survivor): it
threw a Character 6.2 units at the minimum knockdown and 9.0 at a full charge,
roughly thirteen body widths, so a single swing from open ground cleared the
arena. At 0.45 those become 2.2 and 3.6 — about five body widths at full
charge, so a rim is dangerous and open ground is not, and herding someone to
the edge is the skill rather than landing one lucky hit.

That number is a sweet spot on two axes, not a midpoint. The *spread* between
a minimum knockdown and a full charge is widest there (+1.4 units, a 64%
difference), which is what makes holding the button worth doing. Below about
0.3 the spread collapses — at 0.2 a full charge threw no further than a half
one, because friction eats the difference — and hold-to-charge stops meaning
anything for displacement. The full measured table lives on the constant.

**Scenery throws nobody.** `THROWING_RAGDOLL_CAUSES` is `{Hit, Bump}`. Applying
the throw to every cause made the seeded base race uncompletable on the first
run — its spinning squares threw the walkability test's walker off the deck it
was rounding, at s ≈ 297.5. That was a useful failure rather than a tuning
problem: the mechanic asked for is Players shoving each other, and a Spinner
launching someone across the Track is a different (and unrequested) game.
`baseRace.test.ts` passes unchanged under the narrowed rule.

**A Grab drags at full speed** (`GRAB_SPEED_MULTIPLIER` 0.1 → 1), **holds a
knocked-down Character**, and **lets go on a second press**.

- *Dragging a body* cannot go through the wish velocity: a down Character's
  capsule is switched off and its ragdoll's bones are what exist. `Ragdoll.drag`
  sets every bone's horizontal velocity, leaving the vertical to gravity, and a
  body that falls behind past `GRAB_DRAG_LEASH` is reeled toward its grabber so
  the hold stays a hold rather than stretching into a tow rope. A down
  Character contributes nothing to the tether — it is unconscious, whatever its
  Player is still leaning on.
- *Letting go* is the same button. A press while engaged is never a new grab
  (your hands are full), so the two readings cannot collide, and a deliberate
  release is checked before the struggle and timeout so it always wins the tick.
- *Being engaged* is now an explicit flag. It used to be inferred as
  `grabSpeedMultiplier < 1` — "engaged" read off "moving slowly" — which stops
  being true the moment a hold stops slowing anyone down. Inferring a state
  from a tuning value is one retune away from being wrong, and this retune was
  it.

## Consequences

- A Hit is now worth landing even when it doesn't knock down, which is most of
  them: `HIT_IMPACT_MAGNITUDE` (6) shoves at 3.3 units/s, over half a walk.
- Knocking someone down near an edge is a way to remove them. On a Race Track
  that also means a Bump near a drop is now genuinely dangerous — intended, and
  the reason the base race's own walkability test is the guard it is.
- A hold is no longer symmetric in the way it was: a grabber at full speed can
  carry a struggling Character somewhere it does not want to go, and carry an
  unconscious one anywhere at all. Whether three seconds (`GRAB_HOLD_MAX_MS`) is
  too long to be dragged is a live question, not a settled one.
- `CONTEXT.md`'s Grab entry said "both Characters move at a greatly reduced
  pace" and is updated: that is no longer what a Grab is.
- Every number here is provisional in the way this repo means it — named
  constants in `packages/shared/src/tuning.ts`. How it plays is the user's own
  check.
