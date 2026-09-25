# 0121 — A punch you can see coming

## Context

`DG_punching_glove.glb` (2026-09-21) is a wall box 1.68 × 1.76 × ~1.2 m with
a housing, rails, a front plate, a mount and an idle button. Its clip
(`Puncher_Action_V14`, 1.83 s) shoots a glove **2.3 m** out in about half a
second, holds it, and pulls it back; a bellows stretches behind it (scale y
0.1 → 2.1) and the glove itself scales from nothing, so at rest there is no
glove at all — just a plate with a button on it.

Two things about it do not fit what M16 has built so far.

**It is skinned.** The mitt is bound to a `Glove` bone in a
`Puncher_Armature`; every Asset the game loads is rigid nodes, the collision
reader has never read a skin, and the renderer clones Parts node by node,
which a `SkinnedMesh` does not survive.

**It is too slow to matter.** 2.3 m in 0.5 s is 4.6 u/s. The speed-gated
Impact rule (ADR 0037, as M11 applies it) staggers from 6.67 u/s and knocks
down from 15, so the authored punch would *shove* — which is not what a
boxing glove is for.

## Decision

**The glove is a Part that slides, on a clock or on a trigger, and it is
re-timed so the rule the rest of the game uses does the work.**

- **Both modes, and the author picks** (the user, 2026-09-21: "1 i 2
  nastavitelné v builderu"). Timed is the trap door's clock — period, phase —
  and a row of gloves can be sent in a wave. Triggered waits for a Character
  within its reach and then punches, after a wind-up long enough to be read.
  One Asset, one panel, a mode switch.
- **The punch is fast enough to knock down** (the user: "zrychlit ji, ať platí
  normální pravidlo"). The authored curve is replayed as authored — the
  bellows, the hold, the retract — with its *punch* phase played faster, so
  the glove crosses its 2.3 m at over 15 u/s and the ordinary Impact rule
  says knockdown without a special case. A slowed one still only shoves,
  which keeps the gate meaningful.
- **The skin is baked out at conversion** (the user's call). The bone
  translates and scales along one axis, which a plain node does exactly as
  well; `pnpm convert:df` bakes the mitt at its bind pose and drops the skin,
  and the glove becomes a `moving` Part like a sweeper's rotor. The converter
  carries the exception, and the note that a re-export without the armature
  would retire it.
- **`Puncher_Action_V13` is dropped**; V14 is the punch.
- **At rest there is no glove.** The authored scale-0 is kept: the box is a
  plate with a button, and the glove exists only while the punch is out —
  drawn and collided together, so what hits you is what you can see.

## Consequences

- The first Asset whose *collision* appears and disappears with its own
  animation rather than with a state a Round tracks (ADR 0118) or a clock
  position (ADR 0117). It falls out of the same machinery: a Part that is
  solid only where its curve says so.
- A triggered mode is new in M16 — the trap door deliberately has none (ADR
  0117). It earns it here because a punch that fires into an empty corridor
  every four seconds is scenery, and one that waits is a trap.
- The re-timing is a number in the def, not a re-export: the authored curve
  stays the source, played at the speed the def asks for.

## As built

- **Unbinding the skin was one line, not a bake.** Blender writes a rigidly bound mesh in
  model space with the inverse bind matrix undoing its joint's rest, so dropping `skin`
  leaves every mesh exactly where the model shows it. The converter checks rather than
  assumes: a skinned node that also carries its own transform would move, and fails the
  conversion instead.
- **Every piece of the authored motion survives, because the bone scales map to plain
  node scales.** The bellows' stretch is `[1, 0.1, 1]` in a bone whose local Y points along
  model +Z — so it is a Z scale about the bone's origin, which a node does. The glove's and
  the button's are near-uniform. What made that work is that `punchPose` carries the pivot
  correction, so each piece swells about the place it is bolted to rather than about the
  Asset's origin.
- **`rate` is one number over the whole curve**, not a re-timed phase: the punch, the hold
  and the retract all play faster together. At 3× the fist's quickest is over 18 u/s
  against the 15 that knocks down, and the whole punch takes 0.61 s.
- **Drawn size is part of a pose, for these bodies alone.** The glove grows from nothing,
  which no other Asset does; `punchPose` returns a scale beside the position, the renderers
  apply it, and physics never sees it — the fist is solid only where it is full size
  (`punchLanded`, 0.9), so a glove growing out of a plate hits nobody.
- **A Part may be drawn and never collided.** The bellows and the button have no collision
  at all, which the Parts test now states as a rule: a Part has solids exactly when it has
  collision.
- **The triggered mode is not built yet, and the reason is worth writing down.** A punch
  that starts when somebody comes into reach has to *remember* the Tick it started on, so
  its pose stops being a pure function of the Tick — which is the contract every body in
  M16 has. It needs per-Segment replicated state, the shape ADR 0118 built for the fragile
  floor, and its own latch on the client. That is a piece of work of its own rather than a
  branch inside this one, and the timed mode is what ships first.
