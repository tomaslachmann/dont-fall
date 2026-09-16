# 0007 — pnpm monorepo with a shared simulation package

The project is a single pnpm-workspace monorepo:

```
packages/shared/   Simulation step, domain types, tuning constants — runs on client AND server
apps/client/       Three.js renderer, input, camera, prediction, interpolation
apps/server/       Authoritative Node match server (M2+)
```

Client and server must run byte-for-byte the same simulation step (ADR 0003,
0005), which requires sharing real compiled code, not a copied file or a
published package with release lag. A monorepo makes `packages/shared` the single
source of truth from M1, before the server exists. Separate repos or a
client-only package would force the shared step to be extracted later — exactly
the kind of retrofit the architecture is designed to avoid.

## Consequences

- `apps/server` is created empty/stub at M1 or added at M2; `packages/shared` is
  populated from M1.
- Anything that must behave identically on both sides belongs in `packages/shared`;
  `apps/*` hold only their side-specific concerns.

---

## Amended by ADR 0074 (2026-09)

- A third package, `packages/render` (`@dont-fall/render`), holds three.js rendering shared by
  the game and the Track builder. It is imported only by `apps/client` and `apps/track-builder`,
  never by `apps/server` or `apps/api`, and lists `three` as a peer dependency.
- `packages/shared` keeps this ADR's mandate and stays three-free: rendering is not something that
  "must behave identically on both sides". Render-only *data* the API validates (the Environment
  presets) still lives there.
