# 17 — Wire the new Track blocks into `assetModules.ts`

**What was built:** `ASSET_MODULE_DEFS` entries (footprint, Sockets, default Surface) for the 24
blocks in the 2026-09-11 asset drop, alongside M8's existing four. 28 Modules total.

**Status:** done — wiring complete and live-verified. Two content follow-ups noted at the bottom.

## Decided scope (user, 2026-09-11)

- The new blocks sit **alongside** M8's four, not replacing them. `ASSET_DEMO_TRACK` and every M8
  physics test are untouched, and no saved Track is invalidated.
- Z-up geometry was fixed **at the source** — re-exported from Blender with "+Y Up" — not rotated
  in shared code. One frame for every asset; shared never transforms authored geometry (ADR 0050,
  amended 2026-09-11).

## What already landed

- `readAssetModel` reads the role off the **node name** when `extras.role` is absent — the new
  files carry no custom properties. Matches on whole words with camelCase/separator splitting, so
  every spelling this drop has shipped reads the same (`Track_Straight_1x1_Collision` from the
  first export, `CollisionMesh` from the second). `extras.role` still wins where present; an
  explicit-but-typo'd role, a name carrying both words, and a name carrying neither all still
  fail. (`packages/shared/src/track/asset.ts`, tests in `asset.test.ts`, ADR 0050 amendment.)
- **`pnpm check:assets`** (`scripts/check-assets.ts`) — run it after every export, before wiring
  anything. Reads each GLB through the real shared reader and checks the three things that are
  invisible in Blender's viewport: role resolution, Y-up frame, and outward winding. Takes
  filenames to check just a few. This is the loop to use rather than a round trip through me.

## What landed

**`pnpm check:assets` → 28/28 OK.** Third export: Y-up, correctly wound, roles readable.

24 new defs, all measured off the real files and re-measured by `assetModules.test.ts` on every
run. The set is a finer, uniform grid than M8's four: **2 world units per "1"**, a 0.5-thick deck
whose top sits at **y = 0.25**, every piece origin-centred.

| family | ids | Sockets |
|---|---|---|
| straights | `straight_1x1` `1x2` `1x4` `1x8` | entry +Z / exit −Z, deck y = 0.25 |
| wide decks | `platform_2x2` `platform_3x3` | straight through |
| ramps | `ramp_up_1x1` `1x2`, `ramp_down_1x1` `1x2` | rise/fall 0.5 across the piece |
| turns | `corner_90_r1` `curve_90_r2` | entry +Z / exit **+X** — a right-hand turn |
| raised decks | `bridge_1x2` `tunnel_1x2` | straight through, deck y = 0.75 |
| specials | `special_bounce_pad_1x1` `special_hole_1x1` `special_moving_platform_1x2` `special_spinner_mount_1x1` | straight through |
| scenery | `barrier_1x1` `bumper_1x1` `cone_post_1x1` `pillar_1x1` `side_rail_left_1x1` `side_rail_right_1x1` | **none** — nothing chains onto a bollard |

The ramps rise 0.5 over their length (~14° on the 1x1, ~7° on the 1x2), far inside the walkable
band (ADR 0037) — so unlike M8's `ramp_45`, which had to be seated *descending* because a 45°
climb is unclimbable, these genuinely climb and the "up"/"down" in their names is true. Measured
off the files, not assumed from the names.

`special_bounce_pad_1x1` carries `surface: "bounce"` — a real Surface (ADR 0036, M3.7 ticket 02),
so that one does what its name says.

### Verified

- `pnpm -r test` green outside the pre-existing `apps/client` design-drop failures; typecheck clean
- Physics, in the real sim: three different deck lengths chain flush and walk seamlessly; a walker
  climbs `ramp_up_1x2` and ends 0.5 higher; an up/down pair cancels exactly; `corner_90_r1` seats
  the next Segment heading +X and a walker crosses it and leaves on the +X side; the bounce pad
  resolves to the `bounce` Surface
- All 28 load over **real HTTP** from a running track-service through `loadAssetLibrary` — 412
  collision triangles total, zero validation warnings
- Track builder: all 28 render previews on one shared WebGL context, and place and chain in the
  viewport

### Tests that can no longer drift

The id list, the `loadAssetLibrary` URL list, and the builder's preview/template counts all used
to hardcode "4". They now read the `assets/` directory (or `ASSET_MODULE_DEFS.length`), so the next
drop fails for a real reason — a file nobody wired up, or a def with no file — rather than for the
count.

## Content follow-ups (not wiring — these need Blender, or new code)

1. **Several collision meshes are blockout boxes.** `corner_90_r1`, `curve_90_r2`, `bridge_1x2`,
   `tunnel_1x2` and `special_hole_1x1` are all plain 12-triangle boxes: the corner and curve are
   square pads rather than arcs (a 90° turn still works across them, which is why they are wired
   as turns), the tunnel has no bore and the bridge no span so both play as raised decks you walk
   *over*, and the hole has no hole. Fine as blockout; the defs won't need to change when the real
   shapes land, only the footprints get re-measured.
2. **Three `special_` pieces carry no mechanic.** `special_moving_platform_1x2` — there is no
   moving-platform entity in the simulation at all. `special_spinner_mount_1x1` — Spinners are a
   Module-level `spinners: SpinnerConfig[]`, which `AssetModuleDef` does not carry; wiring one
   means extending the def shape and `attachAssetGeometry`. `special_hole_1x1` — see above. All
   three are placeable decks today and nothing more.

## Watch out (still true for the next drop)

`loadAssetLibrary` fails the **whole** library on the first bad file, by design — so a def pointing
at a file that doesn't parse takes down the match server's boot and every client's Track load, not
just that one Module. Run `pnpm check:assets` before committing a def.
