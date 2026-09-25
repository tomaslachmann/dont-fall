# 0116 — An Asset can be more than one body

## Context

Four authored GLBs arrived on 2026-09-21 (`DF_sweeper-2-arms`, `DF_shooter`,
`fragile-block`, `trap-door`). Three of them have **parts that move against
each other**, which nothing in the repo can express:

- the sweeper is a fixed round base (⌀3.44, deck at y = 1.48) and a
  `Sweeper_Rotor` child carrying two arms out to ±3.78, sweeping at y =
  0.38–1.32 — one authored clip turns the rotor 360° in 5.04 s;
- the trap door is a fixed frame 5.33 × 3.93 with two leaves hinged at
  x = ±2.16 that fall 88° away from each other;
- the shooter is a carriage with three nested pivots (yaw ±35°, pitch
  −5°…+25°, a 0.18 m recoil) — angles the converter reads off the clips,
  not off the frame the file happened to be saved on.

A Segment (CONTEXT.md) is **one** rigid instance of a Module with **one**
Motion (ADR 0061). Spinning a sweeper today spins its base with it. The only
existing precedent is the fan, whose rotor `convert-fan.ts` splits into its
own visual node (`fan_Rotor_Visual`) — and which nothing ever turns.

The other half of the problem is the pipeline. The shared reader
(`asset.ts`) refuses any meshed node without `extras.role` or a
`_Collision`/`_Visual` name, so **all four files fail to load as exported**.
Every Asset in the game arrives through a convert script; these have none.

The user's call, in two rounds on 2026-09-21: the author places **one** thing
("automatizovaně, žádné 2 kusy skládací ručně"), and the split is the
engine's ("Jeden Segment, engine si ho rozloží").

## Decision

**An Asset def may declare Parts, and one placed Segment resolves into one
body per Part.** A **Part** is a named subtree of the Asset, converted with
its own collision, carrying its own role:

- `still` — baked into the Track's statics exactly as a whole Asset is today;
- `moving` — its own body, posed by a pure function of the Tick, ridden and
  hit through the M11 Impact rule (ADR 0061) with nothing new in it;
- `gated` — a body whose collision exists only in its rest pose (ADR 0117).

**The stored Track does not learn the word.** A parted Asset is one Segment
with one `moduleId`, one transform and one set of Attachments (ADR 0099).
Placement, publish validation, Duplicate, the overlap check (ADR 0106), the
Socket re-chain and every MCP tool are untouched — a thing the author cannot
take apart is a thing the author cannot break. The seam is
`resolveTrack`'s `segmentBody` (ADR 0098's visitor): it answers per Part
instead of per Segment, and `resolveModuleBodies` emits one body per moving
Part instead of at most one per Segment.

**A Segment's `motion` Attachment addresses its moving Parts.** On a parted
Asset the builder's MOTION panel edits the Part's movement, starting from the
def's own authored numbers (the sweeper's 1.25 rad/s, read off its clip), so
placing one and playing it needs no authoring at all. A def with no Parts
behaves exactly as before — this adds a case, it changes none.

**A moving Part collides as authored solid shapes (ADR 0065), fitted by the
converter.** `scripts/convert-df.ts` measures each Part and emits box proxies,
because a moving body has never collided as a trimesh and will not start. The
user's call: converter now, hand-authored proxies in Blender only if a fitted
box visibly lies.

**The clips in the files are reference, never played.** Nothing in the game
runs an `AnimationMixer` outside the Character, and a pose every Player must
agree on cannot come from a clip one of them is playing back. The converter
reads the clips to *derive* the defs' default numbers — the rotor's rate, the
doors' open angle and hold, the shooter's sweep — and prints them; the numbers
then live in `tuning/` and the def, where the author can move them.

## Consequences

- Three mechanics (ADR 0117/0118/0119) become authorable on top of this one
  concept instead of three special cases.
- A parted Asset costs more bodies than a plain one: the sweeper is two, the
  trap door three. The body count of a Track is still known before it runs.
- The converter, not the author, decides where a Part begins — by node-name
  prefix in the authored file (`Sweeper_Rotor/*`, `TrapDoor_Left/*`). A rename
  in Blender that breaks a prefix fails the conversion loudly rather than
  silently shipping a base that spins.
- The four files are renamed to the registry's own convention on conversion
  (`sweeper_2arms`, `shooter`, `fragile_block`, `trapdoor` — id is the file
  stem, ADR 0050; `trap_door` was avoided because `trap_` is the ImageToStl
  pack's namespace and a future pack piece could collide with it), and `fragile-block`'s stray `__CUTTER` boolean helper on
  `State2_Block` is dropped.

## Alternatives rejected

- **Two placed Segments, chained by a Socket.** The author would seat a base
  and a rotor by hand and could mis-seat them; the user refused it outright.
- **Motion on a named sub-node, with no Part concept.** The same mechanism
  named for one of its three uses; `gated` collision and a Part's own solid
  proxies would have had nowhere to live.
- **Playing the GLB clips.** Rejected on determinism: both sides simulate the
  pose, and a clip is presentation.
