# Springs: what they should do to a Character, and how to animate them

> Research note under `docs/research/`, parallel to `docs/adr/` (decisions) and
> `docs/milestones/` (specs) — same convention as
> `docs/research/surface-and-volume-mechanics.md`. This file feeds a design
> discussion; it is **not** a decision record.
>
> **Settled (2026-09-15) as ADR 0069** — the recommendation was adopted with two
> changes from the user: the launch keeps your horizontal run instead of
> discarding it (this is a platformer, not an arena shooter), and the strength is
> authored per Segment in the builder (presets *and* an exact height in metres)
> rather than fixed per Asset family. Springs use the launch pad only; bounce is
> not what they are. Section 6's open questions are answered there.
>
> Written 2026-09-15, after the user asked for springs to carry real behaviour:
> *"máme tam kaykit springy a trap springy … musíme k nim přidat nějaké animace
> a fyziku"*. The mechanics the springs would carry already exist in the
> simulation; what is missing is the wiring, the authoring, and every frame of
> visual feedback.

Scope: the eight spring Assets in the converted packs —
`kaykit_spring`, `kaykit_spring_pad_{blue,green,red,yellow}` and
`trap_platformspring{blue,green,red}` — plus the two procedural Modules they
would replace (`launch-pad`, `bounce`). Three questions:

1. **What should a spring do physically** — a fixed launch, or a bounce
   proportional to how hard you land?
2. **Where does that mechanic live** — on the Asset (like `hazard`/`gate`) or
   attached to the placed Segment (like Conveyor/ice/mud)?
3. **What animates, and does the animation touch the simulation at all?**

---

## Recommendation

**A spring is a launch pad, not a bounce Surface; the mechanic rides the Asset;
and the animation is cosmetic, client-side, and keyed off the `launchPadEpoch`
that is already replicated.** In one sentence: *the simulation already does
this, the art does not know about it, and the visual half is a pure renderer
concern that costs zero new replicated state.*

- **Physics.** Reuse `LaunchPadConfig` (velocity SET, Epoch-latched, rising
  edge, already tested). Set the vertical component outright, **keep** the
  Character's horizontal velocity — Quake discards both, Unreal makes each axis
  a separate choice, and a chaotic racer wants the spring to add height to your
  run, not stop it dead.
- **Authoring.** `AssetModuleDef` gains a `launch` field assigned per stem by
  the converters, exactly as `hazard: "spiked"` is (ADR 0061) and as `gate` is
  (ADR 0068). A spring *is* a launcher; it should not be possible to place one
  that does nothing. Strength lives in `tuning.ts` per family, not per
  placement.
- **The trigger box is derived, not hand-measured** — the Asset's measured
  footprint top plus a capsule's height. No new probe script; the `fit:gates`
  precedent is available if a fitted box turns out to be needed.
- **Animation.** A procedural squash-and-release on the placed Asset's own
  visual instance, driven by `launchPadEpoch` changing. No GLB clips (none of
  the source packs contains any — verified), no animation support in the shared
  GLB reader, no collider movement, no protocol change.
- **The collision never moves.** Quake, Source and Unreal all animate the pad's
  art while the push stays a static trigger volume; and in this codebase a
  moving plate would go through the ADR 0061 Impact rule, whose outcomes are
  *push / Stagger / Ragdoll* — not a clean launch.

The one genuinely new piece of plumbing is `resolveTrack` reporting **which
Segment each resolved launch pad came from**, so the renderer can find the
instance to squash. That mirrors the `staticOwners` / `trimeshOwners` arrays
`resolveTrack` already keeps for the gate floor probe.

---

## 1. What exists today

Five facts decide most of this. All were checked against the code, not
remembered.

**(a) A launch pad is already the Quake model, already replicated.**
`packages/shared/src/simulation/LaunchPad.ts` is a trigger box plus a velocity
that is *set*, not added, on the rising edge of the Character's capsule centre
entering it. `CharacterController.triggerLaunchPad` bumps `launchPadEpoch` and
queues one full-velocity write for the next capsule tick — "there is no ongoing
decay state to arm". The Character stays `Controlled`; nothing knocks down.
This is exactly id's `BG_TouchJumpPad`, which does `VectorCopy( jumppad->origin2,
ps->velocity )` — a replace, never an add — and separately fires a *predictable
event*, `EV_JUMP_PAD`, purely so the client can play the effect
([Quake III source, `bg_misc.c`](https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/bg_misc.c)).
The split we want is the split id shipped: **velocity is simulation, the pad's
reaction is a predictable event.**

**(b) A bounce Surface already exists and is proportional.**
`SURFACES.bounce` = `{ restitution: 0.85, minSpeed: 6 }` — it multiplies
*incoming* downward speed on landing, with a floor so a walk-on still does
something. Its own doc comment states the distinction the design turns on: *"a
small fall gives a small bounce"*, versus a launch pad, whose output does not
depend on you at all. Nothing in the Asset set is wired to it, and
`AssetModuleDef.surface` already exists — so tagging a spring pad
`surface: "bounce"` is a zero-new-code experiment available today.

**(c) The spring GLBs are static, single-mesh, and always have been.**
Parsed directly:

| file | animations | visual meshes | nodes |
|---|---|---|---|
| `kaykit_spring.glb` | **none** | 1 (`spring`) | 21 (`_collision`, `_visual`, 12 × `solid_*_hull`) |
| `kaykit_spring_pad_blue.glb` | **none** | 1 | 23 |
| `trap_platformspringblue.glb` | **none** | 1 (`Spiral.003`) | 35 |

The *source* packs have none either (`KayKit_Platformer_Pack_1.0_FREE/Assets/gltf/neutral/spring.gltf`
→ `animations: []`, one node, no skin). So "add an animation" cannot mean "play
the clip that shipped with the art" — there is no clip, and
`packages/shared/src/track/asset.ts` reads only node roles, transforms,
positions and indices. Any animation is something we author: in code, or in
Blender plus a reader that does not exist yet.

**(d) Three precedents for "a mechanic that rides an Asset", and three for
"attached to a Segment".** On the Asset: `surface` (ADR 0036), `hazard:
"spiked"` (ADR 0061 — *"the converters assign it per stem like Asset category,
never at runtime from a name"*), and `gate` (ADR 0068, fitted at build time by a
script). On the Segment: Conveyor (ADR 0064), ice (0066), mud (0067) — all
things that could sensibly be true of *any* deck. The dividing line these six
draw is clean: **if the shape means the mechanic, it belongs on the Asset; if
any deck could carry it, it attaches to the Segment.**

**(e) Nothing on the client reacts to a launch.** `launchPadEpoch` is on the
snapshot and no file under `apps/client/src` mentions it. Meanwhile
`assetVisuals.ts` already builds **one `THREE.Group` instance per placed asset
Segment**, positioned by the same `segmentOrientation`/`segmentScale` the
collision uses — the exact handle a per-spring animation needs. Clones share
geometry and materials, so *transform* effects are free and *material* effects
(a glow, a tint) would need per-instance material cloning.

---

## 2. Fixed launch or proportional bounce?

| | fixed launch (`LaunchPadConfig`) | proportional bounce (`SURFACES.bounce`) |
|---|---|---|
| output | always the same velocity | 0.85 × your incoming fall speed, floor 6 |
| reads your state | no | yes |
| replication | one Epoch, already there | none (re-derived from ground contact) |
| authoring | a trigger box + a vector | one `surface` tag |
| Track design | **the apex is a number the author can rely on** | the apex depends on how the runner arrived |
| failure mode | walking on always throws you the same way, even when you didn't mean it | walking on does almost nothing; a fast landing throws you unpredictably far |

For a **race Track**, the fixed launch wins on the property that matters: a
gap either clears or it doesn't, and an author can place the landing. This is
why every arena shooter picked it — Quake's `trigger_push` is documented as
sending the player to a `target_position` which *"serves as both the aiming
point … and the highest point (apex)"*
([q3df level-design notes](https://ws.q3df.org/level_design/velocity_pad/),
[GtkRadiant manual, appendix D](https://icculus.org/gtkradiant/documentation/q3radiant_manual/appndx/appn_d.htm)).
Unreal's `LaunchCharacter` takes the same shape, with the refinement worth
copying: **`bXYOverride` and `bZOverride` are separate flags** — replace the Z
so the launch height is identical whether you walked on or fell on
(the documented fix for "inconsistent jump heights"), while leaving XY alone so
the run is preserved
([`ACharacter::LaunchCharacter`](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Engine/ACharacter/LaunchCharacter?lang=en-US)).

The current procedural `launch-pad` Module does not do that: its velocity is
`{ x: 0, y: 16, z: -6 }` and `triggerLaunchPad` writes the whole vector, so it
also erases your run and replaces it with the pad's own forward. For springs,
recommend the Unreal split — **SET vertical, KEEP horizontal** — which is a
change to *how a launch pad applies its vector*, and therefore a real decision
that affects the existing Module. (Keeping today's behaviour for the procedural
pad and giving springs the new one is possible but is two rules for one
mechanic; prefer changing both and re-tuning the pad.)

Bounce is not wasted: it stays the right model for a *trampoline deck* — a
Surface some future Asset carries, or an attachment in the inspector beside ice
and mud. It is simply not what a coil spring is.

---

## 3. Where the mechanic lives

**Recommendation: on the Asset def, per stem, from the converters.**

```ts
// packages/shared/src/track/assetModules.ts
export interface AssetModuleDef {
  …
  /** This Asset throws whoever steps on it (ADR pending) — assigned per stem by the converters, like `hazard`. */
  launch?: { strength: LaunchStrength };   // "pad" | "spring" | …, resolved against tuning.ts
}
```

Reasons:

1. **The shape means the mechanic.** A spring that has to be switched on is a
   trap for the author, the same argument ADR 0068 used for finish signs
   (*"A finish sign is always a Finish Zone when placed — no switch"*).
2. **The strength belongs to the family, not the placement.** Four colours of
   `kaykit_spring_pad_*` are one spring in four paints; `kaykit_spring` is a
   taller coil; `trap_platformspring*` is a platform with a spiral under it.
   Two or three numbers in `tuning.ts` cover all eight, and a Track full of
   springs stays predictable to run.
3. **Direction follows the Segment for free.** `resolveTrack` already rotates a
   launch pad's velocity by the Segment's orientation (never translates it), so
   a spring tilted with ADR 0034's free pitch/roll throws you sideways with no
   new code — a genuinely nice emergent authoring move.

Two open edges, both worth a decision rather than a default:

- **Scale.** `placeBox` scales a launch pad's trigger by `segmentScale`; the
  velocity is *not* scaled. So today a 2× spring has a 2× trigger and the same
  throw. "A bigger spring throws harder" is defensible and would be one
  multiplication — but it is a decision, not an oversight to fix silently.
- **Motion.** ADR 0061 resolves a moving Segment's triggers *at the rest pose*.
  A spring on a sliding platform therefore launches from where it started.
  Either state that (a spring with Motion is a warning in the builder, as
  ADR 0068 did for gates) or make pad triggers follow their Moving Segment —
  a bigger change than it looks.

### The trigger box

Derive it, don't hand-author it: the Asset's measured footprint gives the top of
the deck (`bounds.center.y + halfExtents.y`), and the trigger is a box from just
under that top up by roughly a capsule height, inset to the footprint's x/z.
That is one function next to the defs, deterministic, and re-derived whenever a
pack is re-converted. `pnpm fit:gates` (ADR 0068's ray-probed openings) is the
precedent if a measured box ever beats a derived one — the springs are simple
enough that it should not.

---

## 4. The animation: three ways, and why only one of them is cheap

### A. Cosmetic, client-side, keyed off the Epoch — **recommended**

The renderer squashes the spring's own visual instance when it fires, then
releases with an overshoot. Nothing about it reaches the simulation, so nothing
about it can desync, mispredict or cost bandwidth. It is exactly what
`EV_JUMP_PAD` is for in Quake, and what every engine's guidance says to do with
feedback that does not change gameplay: *"the Character's Skeletal Mesh and its
Animation Blueprint are not replicated … variables relevant to gameplay, like
velocity, are"*
([Unreal networking overview](https://dev.epicgames.com/documentation/unreal-engine/networking-overview-for-unreal-engine?lang=en-US)),
and *"eliminate anything that can be computed locally from already-replicated
state"*
([replicating tracked events](https://vorixo.github.io/devtricks/replicating-tracked-events/)).

Five sub-problems, each with an answer already in the codebase:

1. **Which spring fired?** `launchPadEpoch` says *a* pad fired for *this*
   Character; it does not say which. Add `launchPadOwners: number[]` to
   `resolveTrack`'s result, index-aligned with `launchPads` — precisely the
   pattern `staticOwners`/`trimeshOwners` already follow for the gate floor
   probe. The renderer then answers "which Segment" by asking which trigger
   contains that Character's capsule centre on the tick its Epoch rose. Purely
   derived on both sides; not a protocol change.
2. **Remote Characters fire it too.** Every Character's `launchPadEpoch` is on
   the snapshot, so one code path — *epoch value changed since last frame* —
   covers the local predicted Character and every remote one. The local one
   gets it a full round trip early, because the client runs the same step:
   Quake's "predictable event" property, for free.
3. **Prediction replay must not double-fire it.** Store the last animated epoch
   *value* per Character, not a boolean; a replayed tick that re-produces
   `epoch = 7` must be a no-op. (Relevant: ADR 0013 — discrete state always
   snaps.)
4. **Two Characters, one spring, one tick.** Latch the animation per *Segment*,
   not per Character, and re-trigger restarts it rather than stacking.
5. **The mesh is one piece.** A tall coil ideally compresses only its coil, and
   the GLB has no separate node for it. Three options, in ascending cost:
   whole-instance squash about the base (`scale.y` down, `x/z` up, origin at the
   Asset's foot — the classic squash-and-stretch, and these Assets already sit
   on `y = 0`); a converter pass splitting the coil into its own visual node;
   or a height-dependent vertex shader, which forfeits the shared-material
   saving. **Start with whole-instance squash** — it is a transform, so it costs
   nothing per instance — and treat the split as an upgrade with a known home
   (the converters already emit role-marked nodes).

Feel numbers, provisional (a measurement, not a decision — the ADR 0064 idiom):
compress over ~2 ticks (≈66 ms) to ~0.55 height, release to ~1.12 over ~180 ms,
settle over ~120 ms. **The launch happens on the trigger tick, never at the end
of the squash** — the anticipation is drawn *after* the fact, because a visual
that gates the physics is the one way to make a spring feel bad.

### B. Authored glTF clips through the pipeline

Author a compress/extend clip in Blender, export it in the GLB, play it with
three.js's `AnimationMixer` (which the client already uses for Characters).
Cost: an animation authoring step per Asset (eight files, more as packs grow),
animation support in `packages/shared/src/track/asset.ts` (which deliberately
reads only what collision needs), and a decision about whose clock drives it.
Buys: better-looking motion than a scale curve, and a single place to art-direct
it. **Not now** — it is the same feedback as (A) at many times the cost, and
nothing about (A) blocks it later: the trigger and the epoch would not change.

### C. The plate actually moves (a Motion, or a new mover)

Tempting, because ADR 0061 shipped moving Segments that carry riders and hit
Characters. It is the wrong shape for a spring, for three separate reasons:

- **A Motion is a pure function of the Tick** — endless and clock-periodic. A
  spring that fires on a timer whether or not anyone is standing on it is a
  different toy (and one we may want one day: a trampoline on a cycle).
- **Being hit by a mover is the Impact rule**, whose outcomes are push,
  `Stagger`, `Ragdoll` by closing speed — not a clean ballistic launch. A plate
  fast enough to throw you the height of a spring would knock you down, which
  is funny exactly once.
- **A triggered mover is replicated state.** Its phase would have to live in the
  snapshot, with a correction path — the thing ADR 0061 explicitly rejected
  ("Replicating mover poses in snapshots … unnecessary bandwidth").

Worth noting the engine-level reason the physics would not help anyway: a Rapier
kinematic body does not push a kinematic character on its own — riding and being
pushed are code this repo had to write ([Rapier character controller](https://rapier.rs/docs/user_guides/javascript/character_controller/),
and the known moving-platform issues, [#488](https://github.com/dimforge/rapier/issues/488)).
Moving the plate buys no physics for free; it only buys a different bug surface.

---

## 5. What the Track builder should show

The builder's discipline since ADR 0061 is *"shows exactly what the simulation
will do"* — it plays Motion live and tints surfaces by the Impact they would
deal. A launch pad has no preview at all today. Cheapest honest addition: an
arrow from the spring along its resolved launch vector, with the apex marked,
computed from `GRAVITY_Y` — so an author can see whether the gap clears before
playtesting. The same squash animation as the client would be a bonus, not the
point.

---

## 6. Open questions for the grilling session

1. **Keep horizontal momentum on launch, or discard it** (Quake) — and if we
   keep it, does the existing `launch-pad` Module change too, or do we end up
   with two rules for one mechanic?
2. **One strength, or a family per shape?** Flat pad vs tall coil vs the trap
   spring platform — one number, two, or three?
3. **Does `segmentScale` scale the throw?**
4. **Do the retired procedurals go?** `launch-pad` and `bounce` follow
   `speed-pad`/`slow-pad` into `DEPRECATED_MODULE_IDS` (ADR 0064's treatment),
   or stay as grey-box blocks?
5. **Does a spring ever knock you down?** Recommendation is no — it stays
   `Controlled`, as `triggerLaunchPad` already does — but "launched into a
   flailing ragdoll" is on-brand for DON'T FALL and would be a Round-type-free
   way to add chaos.
6. **A spring with Motion**: warn and refuse (gates' treatment), or make pad
   triggers follow the mover?
7. **Cosmetic-only animation** — confirm, since it is the load-bearing choice
   everything else in this note rests on.
8. **`trap_platformspring*` is a platform.** Is it a spring you land on, a deck
   you can stand on and *then* be thrown from, or both?

---

## Sources

- [Quake III Arena source, `code/game/bg_misc.c`](https://github.com/id-Software/Quake-III-Arena/blob/master/code/game/bg_misc.c) — `BG_TouchJumpPad`: `VectorCopy( jumppad->origin2, ps->velocity )` (a replace, not an add), the `ps->jumppad_ent` guard that stops a fat trigger re-firing the effect, and `BG_AddPredictableEventToPlayerstate( EV_JUMP_PAD, … )`.
- [Velocity jump pads (q3df level design)](https://ws.q3df.org/level_design/velocity_pad/) — velocity pads vs target-position pads; the apex is the authored target.
- [GtkRadiant manual, appendix D](https://icculus.org/gtkradiant/documentation/q3radiant_manual/appndx/appn_d.htm) — `trigger_push` / `target_position` keys.
- [`ACharacter::LaunchCharacter` (Unreal 5.8)](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Engine/ACharacter/LaunchCharacter?lang=en-US) and [the Blueprint node](https://dev.epicgames.com/documentation/unreal-engine/BlueprintAPI/Character/LaunchCharacter?lang=en-US) — per-axis `bXYOverride` / `bZOverride`.
- [Unreal networking overview](https://dev.epicgames.com/documentation/unreal-engine/networking-overview-for-unreal-engine?lang=en-US) — cosmetic animation is not replicated; gameplay variables are.
- [Replicating stateful sounds and animations (vorixo)](https://vorixo.github.io/devtricks/replicating-tracked-events/) — prefer deriving effects from already-replicated state.
- [Rapier character controller guide](https://rapier.rs/docs/user_guides/javascript/character_controller/) and [dimforge/rapier#488](https://github.com/dimforge/rapier/issues/488) — kinematic bodies do not carry or push a kinematic character for free.
- Repo: `packages/shared/src/simulation/LaunchPad.ts`, `CharacterController.triggerLaunchPad`, `packages/shared/src/track/Surface.ts` (`SURFACES.bounce`), `packages/shared/src/track/assetModules.ts`, `packages/shared/src/track/Track.ts` (`resolveTrack`, `placeBox`, `staticOwners`), `apps/client/src/render/assetVisuals.ts`, `scripts/convert-kaykit.ts`; ADR 0036, 0050, 0061, 0064, 0065, 0068.
