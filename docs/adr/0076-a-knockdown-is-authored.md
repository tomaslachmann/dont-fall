# 0076 — A knockdown is authored: KO, down, GetUp, and control back once the feet are planted

## Context

ADR 0071 bound BLIP's six-direction `KO_*` / `GetUp_*` clips and left them
undriven. The knockdown stayed ADR 0048's pose, read off the physics
ragdoll's eleven bones. The blocker was named there: the clips carry their
own vertical root motion, because lowering the body *is* how they put it on
the floor, while the simulation owns where the body is. The split to follow
was decided in the same ADR: **physics decides where the body is, the clip
decides what it looks like.**

BLIP v6 (`BLIP_Animated_v6.glb`, 2026-09-16) reworks all six `Death_*`
(2.4 s) and all six `GetUp_*` (2.8 s). The other 38 clips, the model and the
rig are unchanged. The rig's README gives the intended path,
`KO_X → hold → GetUp_X → locomotion`, with `Death_X` a terminal collapse
that nothing gets up from.

Measured against the file before deciding:

| | finding |
|---|---|
| `KO_X` last frame vs `GetUp_X` first | **0.0°** on every bone, all six directions |
| `Death_X` last frame vs `GetUp_X` first | **147–178°** on the limbs |
| floor contact | the lowest skinned vertex stays at the rig origin's y through KO, GetUp and Death (a 0.11 hop early in KO) |
| where each KO lays the body | `F` along the rig's +Z (its forward), `FR` 60° toward +X, then every 60°: `BR` 120°, `B` 180°, `BL` 240°, `FL` 300° |
| lying pelvis | 0.42–0.52 above the rig origin in the clip; the physics pelvis rests about 0.2 above the floor |
| horizontal root motion | none: the body lies up to 0.38 (pelvis) and 1.14 (head) out from the origin, and GetUp brings it back to it |
| clip lengths | KO 1.667 s (50 frames), GetUp 2.8 s (84), feet planted from GetUp frame **32** (1.067 s) |
| Death root | no longer moves (v6); only the pelvis drops |

The game has no death. Elimination in Survival is a Fall into the void,
off-screen.

Settled with the user (2026-09-16), two questions asked: the knockdown is
**KO → GetUp** (`Death_*` bound, unused), and control comes back **once the
feet are planted**.

## Decision

**A hard hit plays the rig's own knockdown: `KO_X`, held down, then
`GetUp_X`, with X picked from the push. Physics keeps deciding where the body
is. The simulation's timers follow the clips, and control returns at the
frame the feet are planted.**

- **Direction is picked from the push, in the rig's frame, once per
  knockdown.** The push is the Character's horizontal velocity on the first
  frame it is drawn down. While `Ragdoll`, that is the ragdoll's own velocity,
  impulse included, and it is already on the wire (`velocity`). The push is
  turned into the model's frame at that moment. Sectors are 60° wide around
  the measured centres (`F` 0°, `FR` 60°, `BR` 120°, `B` 180°, `BL` 240°,
  `FL` 300°), lower edge inclusive: the rig's own manifest rule. With no
  horizontal push, the fall is `B`. The direction is kept from the fall to the
  end of the get-up. No new replicated state.
- **The phases are drawn off the replicated `motionState` edges**, with
  render-side clocks, like the jump sequence (ADR 0071):
  - `Ragdoll` plays `KO_X` from its first drawn frame and holds the last
    frame.
  - `GettingUp` plays `GetUp_X` from its first drawn frame.
  - Back in `Controlled`, the rest of `GetUp_X` plays out while the Character
    stands still. Anything else takes the body back through the ordinary
    crossfade: moving, jumping or leaving the ground, a Dash, a Grab, a Hit
    reaction, a Wobble.
  - A reconciliation straight from `Ragdoll` to `Controlled` (ADR 0015) drops
    the knockdown at once.
  - A rig first seen already in `GettingUp` plays `GetUp_B`.
- **The rig stands where the Character is.**
  - Horizontally, the rig origin is the replicated `position`: the physics
    pelvis while down, the capsule once up. The clip's own offsets stay
    inside the skeleton (the manifest's `visual_root_xy: zero`), so there is
    no slide and no snap at the hand-back.
  - Vertically, the origin is the higher of the floor under that point and
    where standing feet would be (`position.y − RAGDOLL_PELVIS_TO_FEET`
    while down, `− CAPSULE_BOTTOM_OFFSET` while getting up).
  - Lying on a deck, the floor wins, which is where the clips are authored
    to be played. Launched into the air or knocked off an edge, the body
    rises and falls with physics while the clip plays.
  - The floor is a short downward ray against the Stage's own collidables,
    started just above `position`.
- **The timers follow the clips.**
  - `RAGDOLL_MIN_MS` 500 → **1667**, the length of `KO_*`, so a Character
    never starts getting up before it has finished falling.
  - `GETUP_MS` 450 → **1067**, GetUp's frame 32, so control returns the
    moment the feet are planted.
  - `RAGDOLL_MAX_MS` (4000) and the settle rule are unchanged.
  - The minimum time without control per hard hit goes from 0.95 s to
    2.73 s. That is the price of a knockdown you can see, and the first
    thing to tune if it plays long.
- **ADR 0048's bone-driven pose is retired.** `ragdollPose.ts` and its
  `BONE_TO_NODE` are deleted. `Death_*` is bound (`actions.death`) for the day
  the game has a death.

## Consequences

- The ragdoll still simulates, still carries the hit's knockback, and still
  decides when the body has settled. Only its look is gone.
- Its eleven bones still cross the wire (ADR 0018–0025) with no reader in
  the renderer. Dropping them from the snapshot is a bandwidth follow-up with
  its own protocol change, not part of this.
- While a Character is down, its drawn body can lie up to about 1.1 units
  past the physics pelvis in the fall direction. The physics body is never
  drawn, so this only shows where geometry is close: a head over an edge, an
  arm through a thin wall.
- `modelBones.test.ts` pins, against the real file: the KO → GetUp pose
  match, each KO's lie direction against the sector table, and the planted-
  feet frame the timer relies on. A rig swap that moves any of them fails
  there, not in play.
- `CONTEXT.md`: Ragdoll and GettingUp are unchanged as states. Only their
  description of how they look changes.

## Alternatives rejected

- **`Death_X` as the knockdown.** It is the better fall, but it ends 147–178°
  away from where `GetUp_X` begins, and a crossfade would only hide limbs
  swinging through each other. It needs get-ups authored from its own end
  pose.
- **The whole GetUp at zero input (2.8 s).** That puts at least 4.5 s
  without control on every hard hit. ADR 0072 already cut Falls down for
  exactly this reason.
- **Sliding the rig so its drawn pelvis tracks the physics pelvis.** The
  clip's pelvis travels 0.38 back to the origin during GetUp, so the planted
  hands and feet would skate. The origin-at-position rule needs no
  correction at the hand-back.
- **Matching the drawn pelvis height to physics every frame.** The physics
  body drops faster than the clip does, so the feet would sink through the
  deck for the first half second. That is the "two vertical authorities"
  fight ADR 0071 warned about.
