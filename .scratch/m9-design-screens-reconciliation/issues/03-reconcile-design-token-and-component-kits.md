# 03 — Reconcile `@dont-fall/ui` vs `test_components/ui/`

**What to build:** A single decision on which component kit and design-token source the shipped
app uses — `@dont-fall/ui` (`packages/ui`, 13 components, built against
`@dont-fall/shared/design/tokens.css`) or `test_components/ui/` (17 components, built against
`test_components/src/styles/tokens.css`) — or a defined migration path between them.

**Blocked by:** nothing (this is the decision itself), but blocks every wiring ticket (5, 7, 8)
that touches a Screen still built on `@dont-fall/ui`.

**Status:** planned

## Why

The uncommitted `main.tsx` diff comments out `@dont-fall/shared/design/tokens.css` — the real
token source every `@dont-fall/ui` component is styled against — in favor of
`test_components/src/styles/tokens.css`. `LobbyScreen`, `StandingsScreen`, `LoadingScreen`, and
`PracticeHud` all import `@dont-fall/ui` components (`Screen`, `Modal`, `LiveOverlay`, etc.)
styled by the retired tokens. Swapping the import silently breaks their visual styling without
touching a single one of their files. Left unresolved, the app ends up with two parallel,
differently-named design-token systems and two component kits with no reconciliation plan.

See `docs/research/test-components-design-screens-gap-analysis.md`, "ADR/architecture conflicts"
§4.

## What to change

- [ ] Decide: retire `@dont-fall/ui`/its tokens in favor of `test_components`'s kit (migrating
      every current consumer — `LobbyScreen`, `StandingsScreen`, `LoadingScreen`, `PracticeHud`,
      and any `packages/ui` consumer outside `apps/client`), retire `test_components`'s kit in
      favor of `@dont-fall/ui` (porting its 17 components' visual designs into the existing kit),
      or run both with a clear boundary (unlikely to be the right call, but name why if chosen)
- [ ] Whichever direction: one canonical `tokens.css`, imported once, in `main.tsx`
- [ ] Inventory every current `@dont-fall/ui` consumer before touching `main.tsx`'s import, so
      nothing silently loses its styling

## Done when

- [ ] `main.tsx` imports exactly one design-token stylesheet
- [ ] Every currently-real, currently-shipped Screen (`LobbyScreen`, `StandingsScreen`,
      `LoadingScreen`, `PracticeHud`) still renders correctly, visually verified live
- [ ] A short doc note (README in `packages/ui` or an ADR) states which kit is canonical going
      forward

## Watch out

- This blocks tickets 5, 7, 8 — don't start those until this lands, or they'll be built against a
  kit that gets retired out from under them.
