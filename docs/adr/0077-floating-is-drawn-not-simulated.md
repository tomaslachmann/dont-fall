# 0077 — Floating is drawn, not simulated

## Context

A fan's updraft (ADR 0075) holds a Character in the air for as long as it
stays over the fan. The jump sequence (ADR 0071) only ever moves its playhead
forward, so a Character held up for seconds froze on one frame: whichever one
the playhead had reached, usually the fall with the legs braced for a floor
that never came. The user's words (2026-09-16): the loop needs more of the
jump's segments, so the Character doesn't look static. They also asked
whether this needs a new "Flying" state.

A throwaway prototype (`apps/client/prototypes/fan-airflow/`, ticket
`.scratch/fan/issues/00`) put today's freeze beside two answers. The user
picked **LOOP**, at the prototype's numbers, and agreed to the proposal below
on the state question.

What the fan's field does to a Character, measured in the prototype's
simulation (force 40 against gravity −22, capped at 10 u/s): it never hangs
still. It bobs over the column's top. Pushed up to +10, it overshoots about
2.3 units, falls back in at about −10, and is caught again, roughly every 2 s.

## Decision

**Floating is a render-side phase of the jump, not a `CharacterMotionState`.**

- **No new sim state.** Each motion state exists because it changes what
  input or physics does: `Stagger` scales input, `Sliding` changes movement,
  `Ragdoll` takes the body. An updraft changes neither. The Character stays
  `Controlled` with full air control, and the Volume only adds force. A state
  would cost a protocol change and an ADR 0013 snap path, and buy no gameplay.
- **Whether a Character Floats is a pure function of its position.** It is
  Floating when its capsule centre is inside a Volume that holds it up. The
  Volume is the one the simulation itself picks: `volumeAt` over
  `byVolumePriority` (now shared, and used by `RapierSimulation` too). "Holds
  it up" means `holdsAloft`: the upward push beats gravity. A sideways wind,
  or an updraft too weak to beat gravity, only bends a fall. The client
  already has the resolved Volumes and every Character's position, so remote
  Characters Float with no replicated bit.
- **Floating is latched.** Entering such a Volume while airborne starts it.
  It ends on landing, or `FLOAT_RELEASE_MS` (1000) after the last frame
  inside one. That outlasts the bob's trip over the column's top. A short
  drift-out fall (about 0.74 s from the top of the fan's field) stays
  Floating until the feet touch down, as the prototype drew it.
- **While Floating, the playhead follows vertical speed both ways
  (`floatLoopTarget`).**
  - Pushed up at `JUMP_VELOCITY`, it reaches the rise end of the loop, 15% of
    liftoff → brace.
  - Weightless, it reaches the apex.
  - Sinking at that speed, it reaches the fall end, at 90%.

  This is the same linear-in-speed mapping the sequence's entry point
  already uses, now allowed to run backwards. The updraft's own bob walks the
  playhead back and forth across `Jump_Rise` → `Jump_Apex` → `Jump_Fall`,
  paced by the physics rather than a timer. A slow breathe (±0.06 s at
  0.7 Hz) keeps a steady speed moving, and the playhead settles toward its
  target at rate 7 to smooth the sim's 30 Hz steps. The push-off still
  plays first, at the ordinary pace. Once the Float lets go, the ordinary
  forward-only pacing takes over. Speed swings never restart the sequence
  while Floating.
- **Two layers go on top, both scaled by the Float's own weight** (0.35 s in,
  0.3 s out; `floatPose.ts`):
  - `Struggle_Air`, slowed to 0.7×, takes 30% of the pose;
  - a procedural layer moves the bones: arms lifting when pushed up and
    flapping, legs paddling, body sway and pitch, head look, crest flutter.

  Every number is the prototype's default, unchanged. The layers draw only
  under the jump's own pose, so a Grab's struggle in the air (ADR 0071)
  keeps the body to itself.

## Consequences

- `JumpFrame` gains an optional `inUpdraft`, and `JumpSequences` gains
  `floatWeight(id)` and `isFloating(id)`. Callers that pass no `inUpdraft`
  see exactly the old behaviour.
- The Float is the one place the jump's playhead moves backwards. The
  "never skips a frame" guarantee still holds, because the loop only ever
  walks across the air pieces.
- The fall after a Float is paced to the floor the jump left from, like
  every other fall. Drifting out over a floor at a different height lands a
  little early or late on the brace, and the landing catches up as it
  always does.
- `CONTEXT.md` gains **Floating**.
- It becomes a real motion state, with its own ADR, the day floating changes
  a mechanic: less air control, no Dash or Hit while aloft, a glide verb, a
  flight Power-up.

## Alternatives rejected

- **HOLD** (the prototype's other answer): rest on the apex under the same
  layers. The user picked LOOP.
- **A timer-driven loop.** It ignores the bob it is drawing: the body would
  swing up while being pushed down.
- **Replicating a "floating" flag.** It would carry nothing the position
  doesn't already say.
