# 0104 — A Grab is a wrestle: Struggle, Limp, Spin and Hurl

## Context

From the user, on 2026-09-18, after ADR 0093 had made a Grab drag at full
speed:

> druhý charakter ten co je držen by měl mačkat třeba nějaké 2 klávesy, jinak
> nereaguje charakter na input, dokud se z toho nedostane a pokud se z toho
> nedostane nezmackne dostkrat ty 2 klavesy, tak skonci v ragdollu.
>
> chování ze strany držícího. může s ním nějak pomaleji chodit celkove i
> otaceni bude pomalejsi ale muze ho nejak roztocit aby s nim hodil, aby
> survival mode mel dobrou mechaniku.

and, looking at the design mock `test_components/src/screens/Grabbed.tsx`
(the held Player's side only):

> musí být i nějaký indikátor pro držícího a co má mačkat pro odhození.

The Grab this replaces (M6 ticket 04, M6.1, ADR 0093) is a rigid tether. Both
Characters stay on the ground and move at the sum of their two wishes, at full
speed. The held one gets free by walking away from the grabber for one
unbroken second. The hold ends by itself after three seconds. Both
Characters' facing is frozen for the whole hold, and a knocked-down body is
dragged by setting its bones' velocity. None of that gives a Survival Round
what the user is asking for: a grabber who pays for the hold and can turn it
into a throw, and a held Player with something to do other than wait.

The rest was settled in a question round the same day. Every choice below
that says "the user's" is an answer from it.

## Decision

### A hold has three phases

1. **Struggle.** The held Character is lifted and carried at arm's length in
   front of the grabber. It ignores all of its Player's input except the
   Struggle. The Struggle fills an escape meter within a fixed window. A full
   meter frees it **on its feet**, with a small shove away from the grabber
   and no knockdown.
2. **Limp.** If the window runs out first, the held Character goes limp in
   the grabber's hands. The grabber gets a **carry window** of its own to walk,
   Spin and Hurl. While Limp the body is *not* a Ragdoll. It is placed by the
   hold, and no get-up clock runs.
3. **Release.** A Hurl, letting go, the carry window ending, or the grabber
   going down all release the held Character. A Limp one is released into an
   **ordinary Ragdoll with a fresh clock**. One released during its Struggle
   without a Hurl lands on its feet, Staggering. A Hurl always knocks down.

The user rejected "carry the body until it would get up anyway", which was
the first thing offered: "tohle chce vyresit, protoze tohle muze rozbit
mechaniku, pokud se zvedne moc brzo". A Ragdoll gets up once its body has
settled, and a carried body never settles. Tying the carry to the Ragdoll
clock would make how long the grabber had depend on physics nobody can see.
Taking the clock out of the hold makes both windows fixed numbers, and a
released body always lies down for a full knockdown. Nobody gets up in
someone's hands, and nobody gets up the instant they are dropped.

**Grabbing a Character that is already down skips the Struggle** and goes
straight to Limp (the user's). It is unconscious and has nothing to wiggle
with. That keeps ADR 0093's "grab i na ragdoll", and with it the combo of a
Hit, then pick the body up, then Hurl it.

**Grab immunity** (the user's) stops that combo from repeating forever
(drop, pick up, carry, drop…). A Character released from a hold in any way
cannot be grabbed again until `GRAB_IMMUNITY_MS` after it is back on its feet.
A Character knocked down by anything other than a hold can still be picked up.

### The Struggle is wiggling, read off the movement input

**One wiggle is a reversal of the held Character's movement input**: a
non-zero `moveDirection` pointing roughly opposite (dot < −0.5) to the last
non-zero one. A→D→A counts, W→S counts, and so does a gamepad stick waved
side to side. The user picked alternating A/D over a single mashed key,
because alternating two keys defeats an autoclicker on one of them.

Reading it off `moveDirection` needs **no new input field, no new binding and
no protocol change**. The input already travels, and a held Character does
not use it for anything else. It is also camera-proof as it stands: A and D
map to opposite world vectors whatever the camera is doing, so long as the
camera does not turn half a circle between two presses.

The meter drains all the time, and a wiggle has to out-pace the drain, so
the Struggle cannot be done in instalments. It drains *continuously* rather
than after a pause: a pause is a timer, and a timer is one more thing a
reconcile would have to carry for the client's replay to agree with the server.

### Being held is a motion state

**`Held` is a new Character motion state**, a row in `MOTION_MODES` (ADR 0101,
"a motion state is a row, not a branch"). It has input scale 0, and its body
is placed by the hold rather than swept by the capsule. Only `GrabHolds`
enters and leaves it, because only a cross-Character decision can.

That is what makes prediction work. The client's local simulation only ever
holds its own `CharacterController`, so no hold is ever resolved on the
client. As long as being held was not a motion state, the held Player's
client kept predicting a walk from WASD that the server was not doing, and
got pulled back on every snapshot. A motion state is replicated and snaps
(ADR 0013). The held client therefore enters `Held` from the snapshot and
**draws its Character from the server while in it**, exactly as it already
does while down (`isDownMotionState` → `localDown`). The escape meter is the
one part the held client predicts. It is a pure function of the Player's own
inputs, restored from `ReconcileBase` like `hitChargeMs`, so the meter answers
a keypress at once instead of a round trip later.

Limp is a phase of `Held`, not the `Ragdoll` state, for the reason in the
section above: Ragdoll owns a get-up clock, and Limp must not have one.

`CLAUDE.md`'s invariant 4 lists the chain `Controlled → Stagger → Ragdoll →
GettingUp → Controlled`. `Held` joins it the way `Sliding` did (ADR 0037).
The Character is still a kinematic capsule driven by a state machine.

### The grabber is loaded

- **Slower.** The grabber walks at `GRAB_CARRY_SPEED_MULTIPLIER` of its pace.
  ADR 0093's full-speed drag (`GRAB_SPEED_MULTIPLIER = 1`) is superseded:
  "může s ním nějak pomaleji chodit".
- **Turns slower.** The grabber's body turns at `GRAB_TURN_SPEED_MULTIPLIER`
  of its usual rate (ADR 0085's `FACING_TURN_RATE` / `FACING_TURN_SPEED_MAX`).
  `facing` is the client's input, so the owning client turns its body slower,
  and **the server clamps the per-tick change** to the same reduced maximum,
  so a modified client cannot whip a body around. The turn constants move from
  `apps/client/src/render/modelFacing.ts` into `packages/shared/src/tuning/`
  so both sides read one number.
- **Hands full** (the user's). No Jump, Dash or Hit while holding. Hit's
  button now Spins, and Grab's lets go, as it has since ADR 0093.
- **The grabber's facing is no longer frozen.** ADR 0085's "a Grab hold still
  freezes it" is superseded for the grabber, which has to be able to turn to
  aim. The held Character faces its grabber.
- **The held body is carried on a spring arm.** Its place is a point at
  `GRAB_CARRY_DISTANCE` in front of the grabber, raised `GRAB_CARRY_LIFT`, with
  its own capsule's collider off (the same "in the world, collider disabled"
  M5 ticket 04 gave an eliminated Character). A shape cast from the grabber
  toward that point stops at the first thing in the way, as the camera's arm
  does. A body swung into a wall is pulled in rather than put inside it, so a
  release never starts a Ragdoll inside the geometry.

The user picked carrying at arm's length over the tether on the ground, so a
Spin swings the body in a clean circle instead of dragging it across the
floor and snagging on posts.

### Spin and Hurl

- **Spin: hold Hit while holding someone** (the user's). The grabber stands
  rooted and turns ever faster, up to `SPIN_MAX_SPEED` over
  `SPIN_WINDUP_MS`. The Spin angle is a pure function of the Spin's own ticks.
  It is predicted by the grabber's client and replicated as `facing`.
- **Hurl: let go of Hit.** The held Character is released into a Ragdoll and
  launched. How hard depends on how far the Spin had wound up. The new
  `RagdollCause` `"Hurl"` joins `THROWING_RAGDOLL_CAUSES`, because it is a
  knockdown a Player caused.
- **Aim: the tangent, pulled toward where the grabber is steering** (the
  user's). The body leaves along the tangent of the circle at release. If that
  is within `HURL_AIM_SNAP_DEG` of the direction the grabber is holding, it
  turns onto that direction. At 30 Hz and a fast Spin, aiming by timing alone
  gives a window of one to three ticks. With the pull, timing still counts,
  but a grabber who holds toward the edge and lets go roughly on time hits it.

  The user's answer said "toward the camera", and this is the one place it is
  translated rather than taken as written. The simulation never sees the
  camera (ADR 0009). ADR 0085 already chose one aim field over a second one
  when the user was asked. `moveDirection` *is* camera-relative, and a rooted
  grabber has no other use for it. So holding W means "where the camera
  looks", and A, S or D aim to the side. If a real camera aim turns out to be
  needed, it would be one more number on `SimInputs`.
- **Overspin: dizzy** (the user's). Holding Hit longer than `SPIN_OVERSPIN_MS`
  past full speed makes the grabber dizzy. The held Character flies off
  weakly in a direction `slipRoll` draws (deterministic, like every other
  coin in the step), and the grabber goes into Ragdoll. Nobody can wait
  forever for the perfect angle, and failing at it is funny.
- **Breaking free mid-Spin flings you** (the user's). The escape still frees
  the held Character on its feet, but it leaves along the tangent with
  `SPIN_ESCAPE_FLING_FRACTION` of the Spin's speed, as a shove rather than a
  knockdown. It can still carry you off the arena.

### A swung or hurled body is a weapon

The user chose **"yes, while spinning and in flight"**. A Character that the
swung body passes through takes an Impact scaled by the body's speed on the
circle, and a full Spin knocks it down. A Character the hurled body lands on
takes one scaled by the body's speed. Each pair counts **once per pass or
flight**, not once per tick of contact. ADR 0093 learned that lesson from the
Bump, which applies an Impact every tick of contact and so pushes a target
out of the harder contact that was coming.

The Spin's check is a query around where the carried body is each tick,
resolved in `GrabHolds`. The flight's check asks the world where the hurled
Ragdoll is, not whether its bones touched anything. That is the same move
ADR 0102 made for `crashIntoCharacters`, after Rapier's controller missed
capsule-on-capsule contacts. A knockdown from either has cause `"Hurl"`.

### The same everywhere

The new Grab behaves the same in a Race and in Survival (the user's), and
reads no `RoundRules` field, as M6 ticket 04's Grab didn't. In a Race a body
hurled off the course Falls and Respawns at its Checkpoint. In Survival it is
Eliminated.

### On screen

- **The held Player: the mock, over the live game** (the user's). This is the
  `Grabbed.tsx` column (`FLOPPO HAS YOU / GRABBED / MASH A D TO BREAK FREE`,
  the meter) plus a thin bar for the window. The keys come from the Player's
  own bindings. Per ADR 0060 there is no Stage background, and a Danger
  vignette sits at the edges so the game shows through. In Limp the column
  becomes `KNOCKED OUT — FLOPPO IS CARRYING YOU`, with no prompt.
- **The grabber: a compact panel, bottom centre, showing the held Player's
  meter** (the user's). It reads `YOU HAVE FLOPPO`, the held Player's escape
  meter and the time left, and prompts from the bindings: `HOLD F SPIN ·
  RELEASE HURL · G LET GO`. While Spinning it shows the wind-up bar, with a
  red overspin zone past full. It sits at the bottom so the grabber can see
  where they are walking.
- Both are fed through the Round HUD's deduplicated snapshot (ADR 0088):
  display-rounded values, raised only when they change.

### Provisional numbers

All of these are named constants in `tuning/fight.ts`. How they play is the
user's live check.

| Constant | Value | Why |
|---|---|---|
| `GRAB_STRUGGLE_WINDOW_MS` | 3000 | ADR 0093's hold limit, now the Struggle's window |
| `GRAB_ESCAPE_WIGGLES` | 12 | with the drain: ~2 s at eight wiggles a second; five a second never gets out |
| `GRAB_ESCAPE_DECAY_PER_S` | 0.2 | drained all the time |
| `GRAB_CARRY_MS` | 2000 | the grabber's Limp window |
| `GRAB_CARRY_SPEED_MULTIPLIER` | 0.6 | 3.6 u/s against `WALK_SPEED` 6 |
| `GRAB_TURN_SPEED_MULTIPLIER` | 0.5 | half of ADR 0085's turn |
| `GRAB_CARRY_DISTANCE` / `GRAB_CARRY_LIFT` | 1.1 / 0.4 | arm's length, feet off the ground |
| `SPIN_WINDUP_MS` / `SPIN_MAX_SPEED` | 1200 / 1.5 rev/s | |
| `SPIN_OVERSPIN_MS` | 1000 | at full speed, before dizzy |
| `HURL_AIM_SNAP_DEG` | 45 | |
| `SPIN_ESCAPE_FLING_FRACTION` | 0.4 | |
| `GRAB_IMMUNITY_MS` | 1500 | after standing again |
| `HURL_MIN_SPEED` / `HURL_MAX_SPEED` | 3 / 10 u/s | measured, below |

The Hurl's launch is **measured, not guessed**, the way ADR 0093 tuned
`KNOCKDOWN_LAUNCH_SCALE`. The target was about 3 u for a flick and about 7 u
for a full Spin, roughly twice a fully charged Hit (3.6 u). A Hurl costs a
catch, a Struggle the other Player can win, and a wind-up, so it has to carry
further than a Hit. Measured on flat ground, from the release to where the
body stopped:

| wind-up | 0.03 | 0.25 | 0.5 | 0.75 | 1 |
|---|---|---|---|---|---|
| distance (u) | 3.1 | 3.5 | 5.1 | 6.2 | 7.3 |

The first guess, 5 and 11 u/s, threw 4.2 and 8.2: a flick already out-threw
the best Hit.

## Considered options

- **A single mashed key** (the mock's "MASH A"). Rejected by the user in
  favour of two alternating keys.
- **Two new bindable actions for the Struggle.** Rejected. They would add a
  field to `SimInputs` and a row to Settings for something the movement input
  already expresses.
- **Keep the tether on the ground.** Rejected by the user. A Spin on the
  ground scrapes along the floor and snags on every post.
- **Aim by timing alone, or by the camera alone.** Rejected by the user. See
  Spin and Hurl.
- **Spin by turning the body yourself.** Rejected. It fights the slower turn,
  and drawing circles with a mouse is uncomfortable.
- **No downed bodies at all, instead of immunity.** Rejected by the user. It
  would lose the Hit into Hurl combo.

## Consequences

- **Superseded:** ADR 0093's Grab section (full-speed drag, struggling by
  walking away, `Ragdoll.drag`, the reel-in leash) and ADR 0085's "a Grab
  hold still freezes it" for the grabber. `GRAB_SPEED_MULTIPLIER`,
  `GRAB_STRUGGLE_FREE_MS`, `GRAB_STRUGGLE_DOT_MIN`, `GRAB_DRAG_LEASH` and
  `GRAB_DRAG_REEL_SPEED` retire, and the tether (`applyGrabTether`,
  `grabTetherWish`) goes with them.
- **Longest time out of control:** a Struggle lost (3 s), a full carry (2 s),
  then a fresh knockdown (1.7–4 s plus a 1.07 s get-up). That is about 8 to
  10 s, which is long by design in a Survival Round. Grab immunity keeps it
  from chaining.
- **Snapshot fields:** the hold's phase and escape meter on the held
  Character, the tick its window ends (the anchor-tick idiom, as with
  `phaseStartTick`), and the Spin's wind-up on the grabber. The meter and the
  Spin are in `ReconcileBase`. The hold itself stays authoritative-only.
- **The first round trip of a catch is still mispredicted on the grabber's
  side.** It walks at full speed until the snapshot says it is holding, the
  same one-RTT engage latency a Grab has today.
- **A carried Character is drawn at its grabber's carry point**, wherever the
  grabber is drawn. Otherwise the grabber's own client, which predicts the
  grabber and interpolates everyone else, would draw the body trailing its
  hands by a round trip, which is 60–80° behind during a full Spin.
- `CONTEXT.md` gains Held, Struggle, Limp, Spin, Hurl and Grab immunity, and
  its Grab entry is rewritten. Tickets are in `.scratch/grab-wrestle/issues/`.

## As built (2026-09-18)

Done on tests (shared 2046, client 1573, server 191, API 323, track builder
775, every package typechecked). What building it settled that the decision
above did not:

- **`isPlayerDrivenMotionState`** (beside `isDownMotionState`) is the one
  question "does this Character's own Player move its body": false while down
  and while Held. The client draws from the server whenever it is false, and
  keeps a Held body out of its mirror obstacles, since a mirror left where the
  server's past had the body stops a grabber walking into its own hands.
- **`RapierSimulation.syncOwnHold`** is how the prediction hears about a hold.
  The client passes it its own row off every snapshot, before the reconcile,
  and it is applied before every tick, replays included. The grabber walks at
  the carry pace and turns at the carry rate, and the held Character's
  Struggle runs.
- **A Held body takes no Impact**, from anything. A queued shove would sit on
  the capsule and fire the moment the hold let go. A Hit never targets a Held
  Character, so a swing at the pair lands on the grabber behind it.
- **The grabber's own client draws the carried body in its predicted hands**
  (`carriedPose`). It takes the body's offset from its grabber off the
  server's world and hangs it off the drawn grabber, turned by however far
  the prediction has turned since.
- **The HUD's meter and wind-up come from the prediction.** Who, which part
  and how long come off the snapshot, and the prompt keys come from the
  Player's own bindings. Unbound shows `—`.
- **The body turn** (`FACING_TURN_RATE`, `FACING_TURN_SPEED_MAX`) moved into
  `tuning/character.ts`. `nextModelYaw` takes a `turnScale` in place of M6.1's
  `facingLocked`, and `modelYawFromFacing` pins a Held or Spinning body to the
  sim's facing.
- **The Limp pose** is the backward knockdown clip (`KO_B`), held on its last
  frame. The rig has no clip of its own for it.
- **The sounds are stand-ins**: getting free is a jump pitched up, going Limp
  a knockdown pitched down, the Spin's whoosh the spinner pass once a turn,
  the Hurl a swing pitched down. No files were sourced for any of them.
- **Both panels are the design's own** (corrected the same day, at the
  user's word: "to je hotový design celé aplikace, tak ho používej a
  nevymýšlej si nový"). `Grabbed` is the mock ported as it is, with its CSS
  identical and its `Danger` vignette restored from git. Its one deviation is
  no Stage background (ADR 0060). The time bar the first version added is
  gone, because the mock has none. The grabber's `HoldingPanel` has no mock,
  so it is assembled class for class from pieces the design has: `Ragdoll`'s
  get-up block, `Spectator`'s key pills and `DashFeedback`'s charge card.
- **Waiting on the user:** everything live. That covers how every number
  plays, whether wiggling A/D reads right, the Limp pose, both panels over a
  real Round, and the stand-in sounds.

## The drawn hold (2026-09-18)

The user's first live look found the hold's animation badly stilted — no spin
on the grabber, and the carried body "fluttering". A Blender pass over the
rig's own clips (headless, against the served `BLIP.glb`) measured why, and
the fixes are **render-only, the user's call**: the sim still carries the
capsule rigidly at the carry point, so swing Impacts and the measured Hurl
table are untouched.

- **The Spin stepped 18° per tick.** The pinned yaw and `carriedPose` read
  the prediction's *raw last-tick* facing; at `SPIN_MAX_SPEED` that jumped
  the carried body ~35 cm around the circle every 33 ms on the grabber's own
  screen. Both now read the prediction's interpolated facing.
- **The hold loop was the wrong clip.** `Grab_HoldIn` is the rig's *hug
  against the chest* — a static pose whose hands sit 0.7 units from the body
  the game carries at arm's length. The measured seams (`Grab_Reach`.last =
  `Grab_HoldOut`.first = `Grab_DropOut`.first, all 0°) say the authored
  arm's-length chain is Reach → **`Grab_HoldOut`** (arms-out hold loop) →
  `Grab_DropOut`. The game now plays that chain; the hug pair is unbound.
- **A hold that ends plays its way out** (`grabReleasePoseAt`): the arms come
  back in through `Grab_DropOut` instead of crossfading from the hold
  straight into locomotion. A grabber that goes down mid-hold (dizzy) plays
  no tail — the knockdown owns the body.
- **The carried body hangs and streams** (`carriedFlail`): drawn pulled into
  the hands (the rig grips at 0.68 ahead / 1.54 up; the sim centres the body
  at 1.1 / 1.25) and hung from that grip along *apparent* gravity — the
  game's own `GRAVITY_Y`, plus the centrifugal push of the body's replicated
  carry speed, plus a drag term trailing the feet behind the travel, eased
  like a pendulum and capped at 65° from vertical. Derived entirely from the
  held Character's own replicated `facing` and `velocity`: no grabber lookup,
  no protocol change, and every client (the held Player's own screen
  included) draws the same stream.
- **A released Spin bleeds off** instead of freezing mid-frame
  (`decayedSpinMomentum`, τ = 0.18 s, seeded from the drawn yaw's own
  measured rate and clamped to `FACING_TURN_SPEED_MAX`). Because the drawn
  yaw *is* the facing the client sends (ADR 0085), the follow-through is
  what the server and every other client see too, with nothing added to the
  protocol.

Still open from the same review, deliberately not in this pass: the pickup
is a one-tick teleport to the carry point while the reach takes 0.67 s, and
the Limp pose is still `KO_B`'s last frame lying flat (plus its 0.34-unit
root offset) — a carried-limp treatment needs its own decision.

## Amended by ADR 0109 (2026-09-19)

A Held own body is drawn from the server only once the interpolated world shows the hold (`ownDrawnFromServer`); until then the reconciled prediction. Remote rigs are drawn at the exact facing through a hold and a Spin (no follow), and a body let go of into a knockdown no longer goes down at a mirrored yaw.
