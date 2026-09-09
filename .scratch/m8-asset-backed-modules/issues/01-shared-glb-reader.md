# 01 — Shared GLB reader + validation

**What to build:** The one function everything else reads assets through:
role-filtered GLB parse plus every load-time check, in `packages/shared`,
testable with no server, no socket, no Rapier world.

**Blocked by:** nothing (first ticket).

**Status:** done (all Done-when items verified in-session; no live item on this ticket)

## Why

ADR 0050 puts a shared reader at the center for one reason: the server and
the predicting client must turn the same bytes into the same geometry
through the same code, or two Players simulate different Tracks. A reader
owned by either side is a second implementation waiting to disagree.

## What to change

- [x] Parse a GLB's JSON chunk: collect nodes by `extras.role`
      (`collision` / `visual`), bake each node's world matrix into its
      vertices, return positions + indices per role — never three.js, which
      must not leak into shared (ADR 0008's boundary covers it)
- [x] Surface extras: `surface` on a collision (sub)mesh resolves through
      `node ?? Module ?? "default"` (ADR 0036); an unknown id is a hard
      error, not the silent default `surfaceConfig` would otherwise give
- [x] Footprint check: collision bounds past footprint +
      `ASSET_FOOTPRINT_EPSILON` (0.02, named tuning constant) fails the load
- [x] Visual check: visual bounds past collision + `ASSET_VISUAL_WARN`
      (0.05) logs a dev warning only — visuals may legitimately vary
- [x] Ignore (don't error on) the stray `collision: True` on visual nodes;
      stripping it is ticket 04's content cleanup

## Done when

- [x] Fixture tests: a minimal synthetic GLB (known triangles, transformed
      nodes) parses to exact positions/indices with transforms baked
- [x] The four real files in `assets/` parse clean under the same assertions
- [x] Unknown surface id, footprint overflow, and missing-role cases each
      fail with a readable error — the same error on any caller
- [x] Nothing in `packages/shared` imports three.js (no shared boundary test
      exists, so asserted in-test via `package.json`; real enforcement is
      the typecheck — three.js is unresolvable from `packages/shared`)

## Implementation notes

`packages/shared/src/track/asset.ts` (`readAssetModel` /
`validateAssetModule`, composed as `loadAssetModule`) + `tuning.ts`
constants + `index.ts` export. 24 tests green, full monorepo typecheck
green, shared 632 / client 271 / ui 21 / builder 88 green (server and
track-service socket suites stay sandbox-blocked, untouched by this ticket).

Findings worth keeping: (1) the in-test GLB assembler initially omitted
`accessors`/`bufferViews` from its own JSON — the reader's "missing
accessor" error caught the test bug, which is the fail-loudly discipline
working as designed; (2) a `const fail = (): never` arrow does NOT
terminate control flow for narrowing under this toolchain (proven by
minimal repro) while a `function` declaration does — `fail` is declared
accordingly, with the reason on it; (3) a present-but-non-string `surface`
extra throws rather than defaulting, extending Q14's fail-fast one line;
(4) explicit BIN range checks so overruns fail readably instead of as
`RangeError`.

## Watch out for

**GLB, not glTF.** The reader takes GLB binary (what Blender exports and
what `assets/` holds). Separate `.gltf` + `.bin` support is scope creep —
fail loudly on non-GLB input instead.

**Indices may be absent.** A non-indexed mesh is legal glTF; the reader must
handle it (positions alone), not assume an index accessor exists.
