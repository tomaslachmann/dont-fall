# 0071 — BLIP is the Character, and the rig's own clips replace the procedural stand-ins

## Context

MushroomKing was never the Character — it was a borrowed rig (Quaternius,
CC0) that retired the capsule placeholder in M6 (ADR 0046) and stayed. It gave
the game five usable clips: `Idle`, `Walk`, `Run`, `Jump_Idle`, `Death`. Every
verb it had no clip for was faked:

- **Grab** aimed the upper arms procedurally every frame (`armReach.ts`, M6.1),
  with its own doc comment saying why: *"no Grab clip exists on the rig"*.
- **Wobble** was a procedural lean (ADR 0010), disabled since M2 because it was
  driven by render-frame position deltas and read as stutter.
- **The knockdown** stopped using the `Death` clip entirely: ADR 0048 replaced
  the reversed-clip arrangement with a pose drawn from the ragdoll's own eleven
  bones, because a clip played backwards never looked like getting up.

BLIP (`BLIP_Animated_v4.glb`, supplied 2026-09-16) is the finished Character:
three meshes over a 20-joint rig, two flat materials, no textures, and **forty
clips authored for this game's own verbs** — locomotion, a six-phase jump,
`Punch`, `Hit_React`, `Grab_Reach`/`Pull`/`Hold`, `Struggle_Held`/`Air`,
`Wobble`, and `KO_*`, `Death_*`, `GetUp_*` in six directions each.

Measured before anything was wired (the numbers decided the work):

| | finding |
|---|---|
| height | 3.52 units — irrelevant, `createStage` normalises any rig to `CHARACTER_VISUAL_HEIGHT` and seats its feet |
| facing | eyes at `z = +0.69`: the rig looks down **+Z** — and so does MushroomKing, and so does the engine's own yaw 0 |
| handedness | `.L` limbs at −X, where MushroomKing's `L` and `RAGDOLL_BONES.upperArmL` are both at **+X** |
| root motion | flat in `Idle`/`Walk`/`Run`/`Punch`/`Hit_React` — genuinely in-place |
| | but up to **1.9 units vertically** in `KO_*`, `Death_*`, `GetUp_*`, `Jump_Full`, `Fall_Back` |

Scope settled with the user (2026-09-16): use everything the rig can do.

## Decision

**BLIP is the Character, and every verb it has a clip for stops being faked.**

- **`MODEL_YAW_OFFSET` is zero**: BLIP already faces the way the engine
  expects. The constant stays, named and documented, because the next rig swap
  has to ask the question and this is where the answer is measured.

  *An earlier version of this decision put π here* — read off the file's own
  node translations rather than the loaded scene graph — and every Character
  walked backwards (found live within minutes: "W turns the character
  backwards"). The measurement that settles it is the engine's own convention
  (`scene.ts`'s forward is `(sin yaw, 0, cos yaw)`, so yaw 0 is +Z) against
  MushroomKing's head axis, which lands on world +Z too.
- **Left and right are a separate question, and BLIP's are crossed.** With both
  rigs facing the same way, MushroomKing's `UpperArmL` sits at x = +0.37 and
  BLIP's `upper_arm.L` at x = −0.70, while `RAGDOLL_BONES.upperArmL` is at
  +0.3: BLIP labels limbs from the Character's own point of view where the
  ragdoll labels them from the viewer's. `BONE_TO_NODE` therefore maps
  `upperArmL → upper_armR` and so on down both sides. Driving them by name
  would cross a knocked-down Character's arms and legs.
- **A remote rig folds the offset into its own yaw** rather than inheriting it.
  `SkeletonUtils.clone` makes the model's group the rig *root*, whose yaw the
  pool overwrites every frame — so any rotation on the clone is gone by the
  time anything draws. Zero today, and wrong the moment it isn't.
- **The bone map is retargeted** to `pelvis`/`body`/`head`/`upper_arm*`/
  `forearm*`/`thigh*`/`shin*`. BLIP has a real pelvis where MushroomKing made
  do with `Body`; 11 of its 20 joints are driven and the rest (hands, feet,
  crest, eyes) ride their parents. Names carry no dot — `GLTFLoader` strips it
  — and that is pinned against the real file, not a fixture.
- **Grab is authored, and `armReach.ts` is deleted.** A holder plays
  `Grab_Reach` → `Grab_Pull` → `Grab_HoldIn`, phased by how long the hold has
  run; the Character being held plays `Struggle_Held`, or `Struggle_Air` off
  the ground. Nothing aims at anything: the server already freezes both
  Characters' `facing` for the length of a hold (M6.1), so they face each other
  before the first frame of it. The role is derived from state already on the
  wire, so this adds nothing to the protocol.
- **A grab at nobody is drawn too, and that one does add to the protocol.**
  A Grab that catches no one reaches out and lets go from arm's length
  (`Grab_Reach` → `Grab_DropOut`, the rig's own path out of an arm's-length
  reach). The first version drew only the hold, so G at empty air showed
  nothing at all. That was true in any match, and always true in free-roam,
  where there is nobody to catch (bug report 2026-09-16).

  An attempt is not visible in `grabbingId`, so it gets its own counter:
  `grabEpoch`, which rises on every attempt whether or not it catches anyone.
  It is `hitEpoch`'s exact counterpart: counted in `CharacterController`,
  replicated, taken uninterpolated from the newer snapshot, and read off the
  prediction for the local Character. One cost of that prediction: the local
  reach starts on the press, but the catch is the server's to confirm a round
  trip later. So the hold, the struggle and the attempt share one clock per
  Character (`GrabAnimations`), and a hold that grows out of a reach already
  on screen carries on from the same frame instead of reaching again. Like
  the jump, every grab pose is set by that clock (`pinClipPose`), not by the
  mixer's.
- **Locomotion, `Punch` and `Hit_React` are rebound** to the new names.
- **The jump is one sequence, paced to the arc, and every frame of it is
  seen.** `Jump_Start` → `Jump_Rise` → `Jump_Apex` → `Jump_Fall` → `Jump_Land`
  lie end to end on one timeline (`jumpSequence.ts`), and together they are
  exactly `Jump_Full`: the pieces are that clip cut at its section boundaries,
  pinned bone for bone against the file. A playhead walks the timeline and only
  ever moves forward. Each frame it is posed onto the piece beneath it
  (`pinJumpPose`: set the time, pause the action), never left to the mixer's
  own clock. The pace is set by the physics:
  - While rising, the playhead aims to reach the middle of Apex just as
    vertical speed reaches zero.
  - While falling, it aims to reach the Fall's brace frames just as the
    Character gets back down to the floor it left.
  - It never plays faster than `MAX_PLAYBACK_RATE` (3×), so nothing is
    skipped. Arriving early, it waits on its frame.
  - After touchdown it shows whatever the air still owes at that top pace,
    then the brace and the landing at authored pace. Mid-stride the landing
    plays at `LANDING_MOVING_RATE` (2×) instead.

  **What this replaced, and why.** Before this, the four air pieces were
  chosen by vertical speed (`jumpPhaseFor`) and each held its last frame.
  Live testing on 2026-09-16 found three problems in turn:
  1. Looped, a 0.2 s apex visibly stutters, so the pieces were made to hold
     their last frame instead.
  2. "We still don't use `Jump_Start`": choosing a piece is not the same as
     showing it. Lengthening `TAKEOFF_MS` and shortening the crossfade fixed
     that.
  3. "The jump can't be seen whole" was structural. Played at its own pace, a piece never fits this
  game's arc, which runs ~0.9 s unheld, ~1.13 s held, and seconds off a
  Spring. Measured against it:
  - The takeoff was cut at 200 ms of its 367, so only the crouch was shown,
    in the air, and the push-off never was.
  - The rise got ~140 ms of its 267 unheld.
  - The fall held its last frames, where the legs brace for the floor, through
    the whole drop.
  - A running landing was cut at 160 ms of its 500.

  `Jump_Full` still isn't bound: it lifts its own root by 1.2 units, height the
  simulation owns. A fixed pace is no longer a reason, since nothing here plays
  at one.
- **Where a sequence starts depends on how the feet left.** A push-off
  (`TAKEOFF_MIN_SPEED`, half of `JUMP_VELOCITY`) starts from the very first
  frame. The authored crouch therefore plays just after liftoff, because a
  jump leaves the floor the frame the button goes down, and delaying that for
  a wind-up would trade input response for a pose.

  Anything slower joins the arc where its speed sits on it. The authored arc
  is a parabola, so clip time is linear in vertical speed, and walking off a
  ledge starts at the top. A mid-air kick of `RELAUNCH_KICK` or more (a
  bounce, a launch pad) starts over. Rising again more gently (an updraft)
  just waits.
- **The landing is the sequence's grounded tail, drawn over locomotion.** It
  needs `LANDING_MIN_AIRBORNE_MS` (180 ms) of air to play at all. A kerb, a
  ramp lip or a Ride's odd ungrounded frame gets no half-second crouch, and its
  sequence is dropped. The landing loses to a Grab and to a Hit reaction, and
  jumping again starts a fresh sequence.

  It is suppressed entirely while `Stagger` owns the body. A Respawn drops the
  Character at its Checkpoint, and the wobble is the whole point of that
  landing (ADR 0072). A knockdown drops the sequence too, so getting up never
  finishes a jump the Character went down in.

## Consequences

- `armReach.ts` and its tests are gone; `remoteCharacterPool`'s `localId`/
  `localPosition` arguments are vestigial (they fed the aiming) and kept only
  so the two call sites stay untouched.
- `modelBones.test.ts` now loads `BLIP.glb` and pins five things against the
  real file: every driven node exists under the name the loader produces, the
  dotted name does *not*, each ragdoll bone is driven by the node **on the same
  side** (whatever that node is called), the rig needs no turn, and the five
  jump pieces are `Jump_Full` cut end to end. That file
  exists because this exact class of mismatch once shipped ("Grab visibly does
  nothing") past every other test in the suite — and it caught nothing this
  time either, because its first version asserted the same wrong premise the
  code did. Both now assert against measurements, not reasoning.
- MushroomKing.gltf stays in `public/models/` for now — unreferenced, and
  cheaper to keep than to re-fetch if anything needs comparing.
- `JumpSequences` owns the airborne clock, the landing edge and the playhead
  in one `advance` call per Character per frame. It replaced `AirborneClocks`
  and `Landings`: the airborne clock and the landing edge are the same piece of
  knowledge, and asking for them separately meant whichever call ran first
  cleared the entry the other needed. The call runs *before* a Hit reaction
  can take the frame, so a Punch thrown in the air doesn't stall the jump
  underneath it.
- Free-roam practice (M8.1) is solo, so its Character never *catches*
  anything: `grabbingId` can only ever name another Character, and there is
  none. `practice.ts` passes the hold arguments as literal `undefined`/`false`
  to say so. G still reaches there, through `grabEpoch`. The first version of
  this ADR called a silent G "not a bug". It was one, and the fix is above.
- The rig is now `BLIP_Animated_v5.glb` (2026-09-16): the same Character and
  its forty clips, plus ten more. One is `Wobble_Walk` (ADR 0072). The other
  nine are emotes, `Win_*`, `Sulk_*` and `Shrug_*`, each an in → hold → out
  sequence, left unbound here: they belong to the Screens, which will wire
  them separately.

## Still to do, deliberately

*Done in ADR 0076 (2026-09-16), with BLIP v6, on exactly the split below.*

**The knockdown stays ADR 0048's ragdoll: `KO_*`/`GetUp_*` are bound but not
driven yet.** The blocker is measured, not a matter of taste: those clips carry
up to 1.9 units of vertical root motion, because lowering the body *is* how
they put it on the floor. The simulation already owns where the body is — while
a Character is down, its reported `position` is the ragdoll's own pelvis, and
the rig is seated from it (`RAGDOLL_PELVIS_TO_FEET`). Play the clip on top and
the two vertical authorities fight: strip the root track and the Character lies
down without going down, keep it and it sinks through the floor.

Reconciling them needs the model on screen — how far the clip drops, against
where physics has put the pelvis, is a number to look at, not to derive. What
is *not* in doubt is the split it will follow, which is the one this codebase
already uses for the Spring's squash (ADR 0069) and the bounce sheet (ADR
0070): **physics keeps deciding where the body is, the authored clip decides
what it looks like.** The six directions are pickable with no new replicated
state, from the Character's own velocity in its facing frame at the moment it
goes down.

`Wobble` found its job the same day: **ADR 0072** gives it to the `Stagger`
state, which had no animation at all, and makes a Fall come back wobbling
instead of knocked down.

## Alternatives rejected

- **Keeping the procedural arm-aiming alongside the Grab clips.** The aiming
  exists only because there was no clip; running both would have the clip pose
  the arms and then the aiming immediately overwrite them.
- **Inheriting the yaw offset on remote rigs.** Tried in reading, not in
  running: the clone is the root, and its yaw is assigned outright every frame.
- **Stripping the root track from `KO_*`/`GetUp_*` so they could be used
  immediately.** That track is how the body reaches the floor; without it the
  clips animate a Character lying down in mid-air.
- **Letting the landing run its full 500 ms whatever the Character is doing.**
  Correct for a landing that ends in a stand, a visible stumble for one that
  ends in a sprint — and this game's Character is usually sprinting.
