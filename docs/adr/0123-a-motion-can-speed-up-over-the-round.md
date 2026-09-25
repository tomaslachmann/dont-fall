# 0123 — A Motion can speed up over the Round

## Context

`DF_sweeper_3_arms.glb` arrived on 2026-09-22, and with it the user's ask
(2026-09-23): sweepers, and Motion in general, should be able to **speed up**.
A Motion (ADR 0061) has only ever run at one pace for a whole Round: a Spin at
its `speed`, a Swing or a Slide on its `period`. A course learns nothing after
its first lap.

A Motion is a pure function of the Tick, so every Player sees the same pose
without it being sent, and a client's reconcile replay (ADR 0027) re-poses a
Moving Segment at any Tick it likes. Whatever speeds it up has to keep that.

The Tick a Motion reads is the Track's epoch, counted from when the world was
built, **not** from when the Round started running: LOADING and the Countdown
both come first, and the second Round on the same Track keeps counting.

Settled with the user in two question rounds on 2026-09-23:

- a **ramp over the Round**, from the Motion's own pace up to a maximum it then
  holds (the Jump Showdown shape), not repeated surges;
- for **all three kinds**, Spin, Swing and Slide, on any Segment, not only
  sweepers;
- authored as **a multiplier and a time**: "N times as fast, T seconds after
  the Round starts";
- **off by default**: no Asset def carries one, not even the three-arm sweeper's.

## Decision

**A Motion may carry a Ramp: `ramp: { multiplier, seconds }`.** It warps the
Motion's clock rather than any one kind's numbers. With `u` the seconds since
the Round started running, the pace `m(u)` climbs linearly from 1 to
`multiplier` over `seconds` and then holds, and every kind reads the warped
time `τ = ∫ m` instead of the Round's own seconds:

- `τ = t` before the Round runs;
- `τ = t₀ + u + (N − 1)·u² / 2T` while it ramps;
- `τ = t₀ + T·(N + 1)/2 + N·(u − T)` after.

A Spin's angle is `speed·τ`, and a Swing's or a Slide's position is its
`backAndForth` at `τ`. The period shrinks by `m` and the phase stays
continuous, so nothing jumps when the ramp starts or when it tops out. One
field, one closed form, and every kind speeds up the same way. A Ramp belongs to
the whole Motion, not to one kind, so a saw that spins and slides speeds up
as one machine.

**The Round's start is the Motion Clock, and it is replicated.** A new
snapshot field, `runningFromTick`, carries the Tick the Round runs from. The
server knows it on the Countdown's first Tick (the Countdown's `phaseStartTick` plus its
length), so it announces it **during the Countdown**, and a client
has it before the ramp moves anything. The client adopts it the way it adopts
`roundRules` (`syncMotionClock`). Outside a Round it is `null`, and a Ramp
does nothing. A Motion stays a pure function of `(Tick, Motion Clock)`, and
nothing per Segment is ever sent.

- A client deriving the start from the phase it sees would learn RUNNING a
  round trip late and mispredict every Ramp by that much. Replicating the
  number from the Countdown on avoids that at the cost of one integer.
- **Free-roam practice** (`?freeroam=1`) and the **Track builder's preview** have
  no Round. Both run their Motion Clock from their own Tick 0, so an author
  sees the ramp as a Round would play it.
- A multiplier below 1 is allowed: a Motion that winds *down* is the same
  formula, and refusing it would be a rule nobody asked for.

## Consequences

- Every place that poses a Motion now takes the Motion Clock: the simulation,
  the renderer, the sounds, the builder. A caller that passes none gets the
  Motion as it always was, so everything written before this is unchanged.
- An Impact's speed comes from how far the body moves in a Tick (ADR 0061),
  so a ramped arm that crosses `MOVING_SEGMENT_STAGGER_SPEED` starts knocking
  people down mid-Round with nothing new in the rule. That is the point.
- The protocol gains one field. `ReconcileBase` does not, because the clock is
  Round state, like `roundRules`.
- A stored Track only gains an optional key inside `motion`. Revisions that
  predate it read exactly as before.
