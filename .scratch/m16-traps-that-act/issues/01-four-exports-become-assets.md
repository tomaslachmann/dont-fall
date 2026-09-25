# 01 — Four exports become Assets

**What to build:** `scripts/convert-df.ts`, which turns the four raw Blender
exports into Assets the shared reader accepts, with their Parts declared and
their moving Parts given fitted collision proxies. After this ticket all four
place in the Track builder and load on both sides — as static scenery, doing
nothing. ADR 0116, "The other half of the problem is the pipeline".

**Blocked by:** —

**Status:** done on tests (2026-09-21) — every visual check is the user's

- [x] The converter reads `assets/DF_shooter.glb`, `assets/DF_sweeper-2-arms.glb`,
      `assets/fragile-block.glb`, `assets/trap-door.glb` and writes
      `assets/shooter.glb`, `assets/sweeper_2arms.glb`, `assets/fragile_block.glb`,
      `assets/trapdoor.glb` (id is the file stem, ADR 0050). The raw exports stay
      in the repo as the sources, the way `Meshy_fan` did
- [x] Every meshed node gets an explicit `extras.role`, so the output never relies on
      the reader's name fallback: visuals as authored, plus one collision node per
      Part built from that Part's own meshes
- [x] Parts are cut by node-name prefix, declared in a table in the script, not
      guessed: `sweeper_2arms` = base (still) + `Sweeper_Rotor` (moving);
      `trapdoor` = frame (still) + `TrapDoor_Left` / `TrapDoor_Right` (gated);
      `shooter` = feet and supports (still) + `Shooter_YawPivot` → `PitchPivot` →
      `RecoilPivot` (moving, nested); `fragile_block` = one still Part with three
      authored state groups. **A prefix that matches nothing fails the conversion
      loudly** — a silently baseless sweeper is the failure this guards
- [x] A moving or gated Part gets box proxies as `role: "solid"` nodes (ADR 0065),
      fitted per Part from its own meshes — the arms, the two leaves, the barrel.
      The still Parts keep trimesh collision as every Asset does today
- [x] `State2_Block`'s `__CUTTER` material and the mesh carrying it are dropped
- [x] The converter reads each file's clips and **prints** the numbers the defs
      default to — rotor rad/s, door open angle / swing time / hold, shooter yaw and
      pitch ranges and periods — rather than writing them. They land in
      `packages/shared/src/tuning/` and the defs by hand, where the author can move
      them (the same rule `convert-fan.ts` follows for footprints)
- [x] `dfAssetDefs.ts` holds the four defs: measured footprints, category
      (`obstacle` for three, `platform` for `fragile_block`), no Sockets (free
      placement), and their Parts. Registered in `ASSET_MODULE_DEFS`
- [x] Tests (shared): all four load through `loadAssetModule` with no warnings;
      each Part's collision lies inside the footprint; the declared Parts cover
      every meshed node exactly once; a missing prefix fails

## Notes

- Measured before writing (2026-09-21): sweeper 7.56 × 1.48 × 3.59, base ⌀3.44,
  arms out to ±3.78 at y 0.38–1.32; shooter 2.29 × 1.9 × 2.51; fragile block
  2.4 × 0.46 × 2.4; trap door 5.33 × 3.93, leaves hinged at x = ±2.16, top face
  y = 0.52.
- The trap door's leaf extras claim `hinge_axis: "Y"`; the clip rotates about Z.
  The clip is right — the converter reads the clip, not the label.
- `fragile_block`'s three state groups sit in the same place and differ only in
  cracks and chips; ticket 04 swaps which is drawn.

## As built

- **`pnpm convert:df`**, reading `assets/DF_source/` and writing the four ids into
  `assets/`. The raw exports moved into that folder, the way `Meshy_fan` already
  had: `check:assets` and the registry test read every `.glb` directly under
  `assets/`, so a raw export left beside the converted ones fails both.
- **`trap_door` became `trapdoor`.** `trap_` is the ImageToStl pack's namespace
  (86 ids), and the pack's converter emits whatever stems its drop contains — a
  name in someone else's namespace is a collision waiting for a re-conversion.
- **Two things the four needed that no Asset had needed before**, both narrow:
  - a node parked at `scale 0` — the authored muzzle flash — bakes to a single
    point ahead of the barrel, and warned "visual escapes collision" for ever.
    A mesh with no extent draws nothing, so it is no longer measured;
  - the fragile block's two fallen chips lie 6.5 cm past the tile, which is what
    a chip that fell off looks like. `AssetModuleDef.visualTolerance` lets one
    Asset raise its own warning threshold with the reason beside it.
- **Every Part gets solid proxies, still ones included.** `solidParts.test.ts`
  holds the line that no committed Asset has only a hollow shell to collide as
  (an author may make any Segment a Prop), and a still Part is no exception.
  What a still Part actually collides as at rest is unchanged: its trimesh.
- **`noCollide` earns its place twice.** The sweeper's 14 painted stripes are
  curved shells that decomposed into 65 hulls; dropping them from collision
  alone took the base from 69 solid parts to 4. The fragile block's cracks and
  chips are dropped the same way, so the tile collides as the intact box
  however cracked it looks (ADR 0118).
- **What the clips turned out to say**, now that they are read rather than
  eyeballed: the shooter's yaw is ±35° (not the ±17° a quaternion's `y`
  component reads like) and its pitch −5°…+25°, so its rest pose is 10° up; the
  trap door holds open 0.75 s, not the ~1.3 s the frame count suggested. Both
  were wrong in this milestone's first draft and are corrected in ADR 0117/0119.
- **Deliberately not done here:** `resolveTrack` still ignores `parts`, so all
  four place as static scenery — which is exactly what this ticket promised.
  Ticket 02 makes a Part a body.
