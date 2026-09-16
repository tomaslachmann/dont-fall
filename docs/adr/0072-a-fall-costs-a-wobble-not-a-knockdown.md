# 0072 — A Fall costs a Wobble, not a knockdown; and Stagger is that Wobble, however it started

## Context

Two things arrived at once: BLIP brought a `Wobble` clip (ADR 0071), and the
user wanted a light hit to leave you walking slowed and visibly unsteady, with
a Fall no longer throwing you into a ragdoll at all.

Half of that already existed and nobody could see it. `Stagger` has been in the
state machine since ADR 0006 — a medium Impact (`IMPACT_STAGGER_MIN` 4, under
`IMPACT_RAGDOLL_MIN` 9) already dropped movement input to
`STAGGER_INPUT_SCALE` (0.35). But it lasted 350 ms and had **no animation of
its own**: the renderer picked an ordinary walk for it, so a staggering
Character looked exactly like a walking one that had mysteriously slowed down.

The other half was harsher than it looked. A Fall called
`machine.forceRagdoll()` and queued a Respawn that re-activated the ragdoll for
a flop at the Checkpoint — so falling off a platform cost `RAGDOLL_MIN_MS`
(500) to `RAGDOLL_MAX_MS` (4000) of ragdoll plus `GETUP_MS` (450) of getting
up, **all at zero input**. One to four and a half seconds of no control, and
how long exactly depended on how the physics body happened to settle.

Settled with the user (2026-09-16), two questions asked: the light-hit wobble
runs ~1.2 s, and the ragdoll goes away for Falls only — a hard hit still knocks
you down, which is what ADR 0071's `KO_*` clips are for.

## Decision

**`Stagger` is the game's Wobble, and how long it lasts is set by what caused
it. A Fall causes one instead of a knockdown.**

- **The duration is chosen at entry, not fixed.** `CharacterStateMachine` keeps
  the length of the Stagger currently running: a light Impact enters for
  `STAGGER_TICKS` (`STAGGER_MS` raised 350 → **1200**), and a new
  `wobble(ticks)` entry point enters for whatever the caller asks — today
  `RESPAWN_WOBBLE_TICKS` (**2000 ms**). A hard Impact queued for the same tick
  still wins: being knocked down outranks being unsteady.
- **A Fall no longer knocks anyone down.** `fall()` drops its
  `forceRagdoll()`, and `respawnAtCheckpoint` puts the Character back on its
  feet — collider on, capsule moved, movement controllers reset — and calls
  `wobble(RESPAWN_WOBBLE_TICKS)`. The ragdoll is never activated, so a Fall
  now replicates no skeleton at all.
- **The wobble is the whole cost of a Fall**, and it is both gentler and
  *predictable*: two seconds at 35% beats one-to-four-and-a-half seconds at
  zero, and a Track author placing a gap can count on the number.
- **`Stagger` is drawn.** `selectLocomotion` gains a `wobbling` input and
  returns a `wobble` state, which maps to the rig's own `Wobble` clip on both
  the local Character and every remote one, read off the replicated
  `motionState`. On the ground it outranks walk, idle and even a Dash — being
  slowed is the one thing the state exists to communicate — and in the air it
  loses to the jump, because a wobble reads as feet under you.
- **A wobble that moves walks** (BLIP v5, 2026-09-16). At first there was only
  the in-place `Wobble`, so a Staggered Character walking or dashing slid
  along with its legs standing still. The v5 rig brings `Wobble_Walk`, which
  is the same unsteadiness with two wide steps. `selectLocomotion` returns
  `wobbleWalk` while wobbling and either moving or dashing, and `wobble` while
  standing. The ordinary locomotion crossfade (0.15 s) sits inside the rig's
  recommended 0.1–0.2 s between the two. A rig without the clip keeps the
  in-place wobble, the tell over the legs, as above.
- **Ragdoll stays for what it is good at**: a hard Impact (≥ 9) and a spiked
  Asset still knock you down, still through the physics ragdoll.

## Consequences

- No new replicated state. `motionState` already crosses the wire, and both
  the duration and the animation choice are derived from it plus the reason —
  the client predicts the same Stagger the server runs.
- A reconciliation that snaps *into* `Stagger` cannot know which length the
  server meant (the wire carries the state, not this machine's timer), so it
  assumes the hit's. That is the shorter of the two: the worst case is a
  respawn wobble ending early, never a Character stranded slowed for two
  seconds it did not earn.
- `RESPAWN_FLOP_IMPULSE` is gone — nothing flops onto a Checkpoint any more.
- Falls still count as Falls: `fallCount`, `respawnCount` and the Results
  screen's fall column are untouched. Only the punishment changed.
- Three tests that used a Fall as a convenient way to reach `Ragdoll` now use
  a hard Impact instead, which is the only thing that reaches it.
- `Stagger` at 1200 ms is long enough for whoever hit you to arrive and hit you
  again — deliberate, and the first thing to re-tune if it plays mean.

## Alternatives rejected

- **A new `Wobbling` state beside `Stagger`.** Two states that both mean
  "upright, slowed, recovering", differing only in how they started — the
  duration is the only thing that actually varies, so it is the only thing
  that varies.
- **Keeping the ragdoll for the fall itself and wobbling only after the
  Respawn.** The tumble is most of the cost and all of the unpredictability;
  keeping it would have kept both.
- **Dropping the ragdoll everywhere.** Put to the user and declined: it would
  cost the game its knockdowns and leave ADR 0071's six `KO_*` clips with
  nothing to draw.
