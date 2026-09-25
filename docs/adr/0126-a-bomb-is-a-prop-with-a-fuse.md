# 0126 — A Bomb is a Prop with a fuse

## Context

The user, on 2026-09-23, right after Props became things you can carry and
throw (ADR 0125): "now we implement a new type, and that's a bomb, we already
have it animated". The drop is `BLIP_Bombs_v1`: two animated GLBs
(`kaykit_bomb_A_blue_animated`, `kaykit_bomb_B_blue_animated`), each with three
clips: `Bomb_Tick` (1.0 s, looped), `Bomb_Tick_Fast` (0.4 s, looped, the
warning) and `Bomb_Explode` (2.1 s, once). Its README places the detonation
**0.14 s into `Bomb_Explode`**. The effect is 41 `FX_*` meshes under a
`Bomb_FX` group, driven by transforms and a `Dissolve` morph. Every node
already carries a `role`, including a new one (`effect`), and the collider is
one `solid_0_hull`. The rendered duplicate collision mesh was removed from the
files.

Until now a bomb was a shape and nothing more. Nine static `kaykit_bomb*`
Assets sit in the Prop category (ADR 0122). Placed as a Prop (ADR 0095), each
one is shoved, carried and thrown like a cone. No Track places one.

Settled with the user in three question rounds the same day:

- **Picking it up lights it.** A lying bomb does not tick.
- **A lit bomb stays lit.** Put down, dropped or thrown, it keeps counting, and
  anyone can pick it up and pass it on: hot potato.
- **Five seconds, the last 1.5 s fast.** These are the defaults. The author
  can retune the fuse and the return on a placed bomb.
- **The blast knocks down everyone in its radius and throws them away from
  it**, harder near the middle and only a Stagger at the edge. **It pushes
  Props** too, other bombs included. It does not chain, it does not break
  fragile floors, and it does nothing else. There is no screen shake.
- **The bomb returns where it was placed** 8 s after the blast (the author's
  number, like a fragile floor's return).
- **A placed bomb Asset is a bomb.** The def carries it (ADR 0120). There is no
  Attachment to switch on.
- **The last one to hold it is credited** with every knockdown its blast causes
  (ADR 0110). If it goes off in their own hands, the blast knocks them down
  too, and nobody is credited for that knockdown.
- **A thrown bomb still hits by momentum**, as every thrown Prop does (ADR
  0125). It goes off only when its fuse runs out.
- **A bomb that falls off the Track goes out** and comes back home, without
  exploding under the clouds where nobody would see it.
- **Black, and only these.** The blue body is recoloured black. The nine
  static bomb Assets are removed, and the two animated ones are the only bombs.

## Decision

### The Asset says it is a bomb; the Segment retunes its clock

A def may carry `bomb: { fuseSeconds, warnSeconds, returnSeconds }`. A placed
Segment of that Asset **is a Prop without saying so**, because a bomb that
cannot be picked up is not a bomb. Its optional `bomb` Attachment retunes
`fuseSeconds` and `returnSeconds` and nothing else. This is the fragile floor's
split (ADR 0118): the Asset owns what is drawn, and the author owns the timing.
The warning is the Asset's, because it is a clip's length on the model. The
blast's radius and strength are tuning (`tuning/fight.ts`), the same for every
bomb, so that a bomb reads the same wherever it is placed.

### The authority owns the fuse; the Snapshot carries it

A bomb has three states. It is **lying** (unlit, at rest, where it was placed
or wherever it was put down), **lit** (with the Tick it goes off on and the
last one to hold it), or **spent** (gone, with the Tick it returns on).

- **Lit on a pick-up.** Only the authority picks up (ADR 0125), so only the
  authority lights a bomb. Every pick-up, the first or a later one, makes the
  one who picked it up its last holder. Throwing a bomb does not change its
  last holder, because the thrower was already holding it.
- **It goes off on its Tick, wherever it is.** In someone's hands, a carried
  bomb goes off at its carry point, and the hold ends first.
- **The blast is one event.** At its Tick the bomb's centre is the blast's
  middle. Every Character within `BOMB_BLAST_RADIUS` takes one Impact of cause
  **`Blast`**, aimed away from the middle with the Bump's lift and falling off
  linearly from `BOMB_BLAST_IMPACT_CENTRE` to `BOMB_BLAST_IMPACT_EDGE`. Those
  numbers were picked so the middle knocks down and the edge Staggers. `Blast` is
  a knockdown another Player caused (it throws the body, ADR 0093). It is a single
  event, so it also shoves a Character who stays up. Every Prop in the radius
  that is not being carried has its velocity changed by up to `BOMB_BLAST_PROP_SPEED`
  away from the middle, with the same falloff.
- **Then it is gone.** A spent bomb is parked where it went off, as a
  Shooter's waiting ball is (ADR 0119): colliders off, and drawn only by its
  own explosion. When its return Tick comes it is put back where it was placed,
  unlit and at rest.
- **Below the kill plane it goes out.** It is parked and spent without a blast,
  and it returns on the same clock.

The Snapshot carries **only the bombs that are not lying where they were
placed**: a row of `detonateTick` or `returnTick`, and nothing for an
untouched Track. A bomb's Prop snapshot carries `live`, as a Projectile's does.
A client **predicts none of it**. The blast's Impacts are the server's and
reach a client the way another Player's Hit does: discrete state snaps
(ADR 0013). What a client does with the row is draw it.

### Drawn from the row, never from a playback of its own

The clips play only on the client, and only for looks. The body is posed by
the Prop, exactly as today. A lying bomb shows its rest pose, with the fuse's
glow and the effect group hidden. A lit bomb loops `Bomb_Tick`, then
`Bomb_Tick_Fast` for the last `warnSeconds`. A spent bomb plays `Bomb_Explode`
once, where it went off, from the blast Tick minus the clip's 0.14 s lead, so
the flash lands on the Tick the Characters go down. After the clip it is drawn
by nobody. Everything is a function of the render clock and the row, so a late
joiner or a reconnect draws the same thing.

### One pack, recoloured and reread

`pnpm convert:bomb` turns the two drops into `bomb_A.glb` and `bomb_B.glb`.
It moves the body's UVs from the atlas's blue swatch to its black one, which
keeps the gradient. It darkens the shell-fragment material the same way, adds
the collision node the shared reader requires (the bomb's own mesh), and keeps
the clips. The shared reader learns the `effect` role: a render-only mesh that
nothing collides as and nothing measures. The nine static bomb Assets and
their files are deleted, and the KayKit converter skips the stem, so a rerun
does not bring them back.

## Consequences

- A second per-object state the Round changes and the Snapshot carries, after
  the fragile floor, and the first owned by a Prop rather than a Segment.
- An Asset's clip is played for the first time, on the client and for looks
  only. That does not contradict ADR 0116's rule that the simulation never
  reads a playback: the bomb's pose, its colliders and its blast are all Tick
  arithmetic on the server.
- `Blast` is a new `RagdollCause`, so every exhaustive switch over causes
  (sounds, reactions) has a case to write.
- A Survival arena can now be won with a bomb. How strong, how wide and how
  long the fuse should be are the user's live checks. Every number is a first
  guess.

## As built

- **Where the pieces went.** The simulation is in `track/Bomb.ts` (def, timing,
  `bombPhase`) and `simulation/Bombs.ts` (the fuse, the return, the kill plane).
  `RapierSimulation.resolveBlast` handles the blast. The picture is in
  `packages/render/src/bomb/bombLook.ts`: the clips as a function of `BombPhase`.
  A client's `trackVisuals.drawBombs` feeds it from the newest Snapshot's rows at
  `serverInterp.renderTick`. Free-roam practice is its own authority, so its
  bombs light and go off locally.
- **Lit by the pick-up itself.** `GrabHolds` tells the world `propLifted` on the
  Tick it picks up. `letGoOfProp` ends a hold (and any flight) before a blast, so a
  bomb in someone's hands goes off at the carry point after the hold has ended. A
  parked (spent) bomb cannot be picked up (`!prop.inFlight`).
- **Falling off the Track** puts it out and parks it on the same return clock as a
  blast (`blasted` stays unset on its row). It does not come straight back: the
  return delay is the whole point of a bomb being scarce.
- **A spent bomb's colliders are off on a client too.** A bomb's `PropSnapshot`
  carries `live`, and `syncPropsToSnapshot` follows it. Otherwise the local
  Character would walk into a bomb nobody can see.
- **Drawn late, never early.** The rows are the newest Snapshot's, but the pose is
  the drawn world's. A bomb the rows have back home can still be parked in the drawn
  world, so it is not drawn until the pose arrives too.
- **Sounds, the user's picks.** The fuse is LilMati's five-second "Ticking Timer 05
  Sec" (CC0). It plays as one voice per lighting that follows the bomb, at
  `5 / fuseSeconds` rate and ×1.5 during the warning, and is cut by the blast. The
  blast is eardeer's "explosion_mid_fuse_1" (CC-BY 4.0), cut 0.3 s in where the
  bang starts. In the same pass the Shooter got its shot (Isaac200000's "Cannon5",
  CC0), heard where each ball leaves the barrel.
- **The carrier's panel** reads `YOU HAVE A BOMB` with the fuse counting down in
  tenths.
- **The builder** draws a bomb at rest: effects and the fuse's glow are hidden,
  because the effect meshes stand at full size in the rest pose. It has a BOMB panel
  (fuse, return). SURFACE shows the bomb locked to PROP. The MCP server gained
  `set_bomb`.

## Amended 2026-09-23: a blast throws like a blast

The user, after the first build: the blast wants more force. It was measured
first. A Character at the middle took an Impact of 18 and was thrown by the
shared `KNOCKDOWN_LAUNCH_SCALE` (0.3), about 5 u/s and nearly flat. That is a
charged Hit's throw, not an explosion's. Settled in a question round:

- **It throws about three times further.** A `Blast` has its own throw,
  `BOMB_BLAST_LAUNCH_SPEED` (15 u/s at the middle), instead of the scale that
  Hit, Bump and Hurl share. Those three do not change. The throw falls off
  with the Impact, as the Impact does.
- **It reaches further.** `BOMB_BLAST_RADIUS` goes from 4 to 6. The
  falloff is unchanged, so the edge still only Staggers.
