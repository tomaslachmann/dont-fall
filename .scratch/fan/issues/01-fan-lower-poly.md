# 01 — `fan_lower_poly.glb` replaces `fan.glb`

**What to build:** convert `assets/fan_lower_poly.glb` into the committed fan Asset in place of
ADR 0075's `fan.glb`: seated, rotor split into its own node, a collision proxy, and a def resized to
the new model.

**Blocked by:** 00 (only for the rotor's node naming, which 02 reads).

**Status:** done on tests (2026-09-16). The look in-game is the user's to check.

**Decided (2026-09-16):** swap now. The user's words: the old fan is ugly, and it can be replaced
by another one later. The size budget was left to me. I started at about 20k tris, the old drop's class, and
**measured it down to 30k housing + 2k rotor, with 1024² textures (≈ 2 MB)**. Rendered side by side,
an 18k housing goes lumpy and loses its corner studs, which may be what made the old fan ugly. 30k
reads like the 63.5k source. The fan is about 2 units across on screen, so 2048² textures are
wasted there.

## What changed

- [x] `scripts/convert-fan.ts` (`pnpm convert:fan`), committed this time: the fan may be replaced
      again. `meshoptimizer@0.18.1` is now a root dev dependency, installed offline from the
      project store, and the lockfile only gained the importer entry.
- [x] Blender's `Cube` is dropped. `Mesh_0` is split by the 0.64 / 0.30 centroid rule into
      `fan_Visual` (housing) and `fan_Rotor_Visual`. The rotor is baked about its own axis, and its
      node stands on that axis (x −0.0012, z 0.0002).
- [x] Seated on the pivot and baked into the vertices.
- [x] Collision is `fan_Collision`, a closed, outward box of 1.899 × 1.180 × 1.899, plus its
      ADR 0065 solid part (the same box). `pnpm check:assets fan` passes.
- [x] Budget: housing 30k tris (0.2% error), rotor 2k (0.6%), images 1024² JPEG q85. The file is
      **1.96 MB**, down from 6.8 MB.
- [x] The source moved to `assets/Meshy_fan/fan_lower_poly.glb`. The assets test only reads
      top-level `*.glb`, and the API only serves flat names. The old `fan.glb` is overwritten, as
      the user asked; a copy was kept in the session scratchpad only.
- [x] `fanAssetDefs.ts`: footprint 0.9494 × 0.5899 × 0.9497 half-extents, and the Volume's foot
      re-seated at 1.1798. The field's numbers are unchanged.
- [x] ADR 0075 amended.
- [x] Tests: the committed-assets test and the solid-parts test now pass. Both failed while the raw
      export sat in `assets/` and the old fan had no solid part.
- [ ] The look in-game, in `day` / `sunset` / `night` (the user's). Textured files can't parse
      under Node, so no test sees the textures.
