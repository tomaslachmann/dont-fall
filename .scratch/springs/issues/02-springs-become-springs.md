# 02 — The eight spring Assets become Springs

**What to build:** the converters assign `launch` per stem, with a trigger box
derived from each Asset's measured footprint — so a placed Spring launches with
no further authoring (ADR 0069).

**Blocked by:** 01.

**Status:** done (2026-09-15).

## What to change

- [x] `scripts/convert-lib.ts`: `launchDefFor(stem, footprint)` — the shared
      derivation, so both converters agree. Trigger: from just under the
      footprint's deck top up by a capsule height, inset to the footprint's x/z.
      Default height per family.
- [x] `scripts/convert-kaykit.ts`: `LAUNCH_RULES` beside `CATEGORY_RULES` —
      `/^spring$/` (the tall coil, the strongest of the three) and
      `/^spring_pad_(blue|green|red|yellow)$/` (the flat pads). Assigned per
      stem, never at runtime from a name (ADR 0061's rule for `hazard`).
- [x] `scripts/convert-imagetostl.ts`: the same for
      `/^platformspring(blue|green|red)$/` — a platform you stand on that also
      throws you.
- [x] Regenerate `kaykitAssetDefs.ts` / `trapAssetDefs.ts`; the eight defs gain
      `launch`. **Not by re-running the converters** — `assets/` is mid-
      reorganisation in the working tree and a full pass would rewrite every
      GLB in it. The eight `launch` blocks were injected by a one-off script
      through the *same* `launchDefFor` the converter calls, and the test below
      pins every one of them against that derivation, so a later re-conversion
      emits byte-identical values.
- [x] Default heights, from `LAUNCH_HEIGHT_PRESETS`: coil `high` (10 m), spring
      pads and trap spring platforms `medium` (6 m) — provisional, one line each
      in the converter, overridable per Segment.

## Tests

- [x] `assetModules.test.ts`: every stem the rules match has a `launch`, and no
      other Asset does — the same revalidation the footprints already get.
- [x] Each Spring's trigger box sits **above** its own collision (a Character
      standing on the deck is inside it) and within its footprint in x/z.
- [x] A Track with one placed Spring resolves to exactly one launch pad whose
      owner is that Segment.
- [ ] Re-running a converter is idempotent for these fields — unverifiable
      until the `assets/` reorganisation settles and a full pass can run.
