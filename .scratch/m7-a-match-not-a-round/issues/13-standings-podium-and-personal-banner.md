# 13 — Standings: the artifact's podium and personal outcome banner

**What to build:** Rebuild the "Round just played" panel on `StandingsScreen` to actually match the
confirmed artifact design
(<https://claude.ai/code/artifact/6f59296b-63c8-48ae-937e-88a43b15e9f4?org=51b43cec-3008-499c-adb6-1ae9a8b9abae>):
an F1-style 3-pad podium for the top 3, each with a live-rendered Character, plus a personal
Qualified/Eliminated outcome banner. Split out of ticket 12, which shipped the Ready-gate mechanic
without it.

**Blocked by:** ticket 12 (the footer/data shape this panel sits inside).

**Status:** superseded by ADR 0059 — `StandingsScreen` is deleted (Match end
moved to the fetched `/match/:matchId` page) and `MatchOver` already renders
a 1–3-place podium there, so there is no panel left to rebuild. Only the
live-rendered Characters (vs `RenderSlot` placeholders) remain genuinely open,
and that belongs wherever `MatchOver`'s poses get built, not here.

## Why

A live audit (M7 ticket 06's own follow-up session) found `StandingsScreen` never actually matched
the confirmed artifact — a flat `#N` list, no podium, no personal banner. This is real, separate
scope (Three.js/GLTFLoader inside a React Screen, the ADR 0008 code-split boundary, an SVG fallback)
that doesn't belong bundled into the same commit as ticket 12's protocol-adjacent Ready-gate work.

## What to change

- [ ] **Podium.** Top 3 of "the Round just played" (`results` — unchanged data, still `buildResults`)
      get the artifact's 3-pad podium (height = rank), each with a rendered Character — the
      artifact's own real `MushroomKing.gltf` via Three.js + `GLTFLoader` (1st plays "Wave," 2nd/3rd
      "Idle"), falling back to the artifact's own flat SVG silhouette if WebGL or the model fails —
      never both at once, same as the artifact's own already-designed fallback.
- [ ] **`<PersonalResultBanner>`.** Own Qualified/Eliminated outcome, using `ExtrudedText`'s existing
      connected-extrusion technique (already a real `packages/ui` component). This content currently
      only exists in the HUD (`matchBanner.ts`, plain DOM) — decide at implementation time whether
      it stays duplicated there too, or the HUD's copy is retired in favor of this one; not
      pre-decided here.

## Done when

- [ ] Component tests: podium renders (including the SVG-silhouette fallback path, testable without
      a real WebGL context), `<PersonalResultBanner>` shows the right outcome.
- [ ] `codeSplitBoundary.test.ts` still holds — the podium's Three.js usage goes through the same
      dynamic-import boundary `GameCanvas.tsx` already uses for `game/index.js`, never a static
      import from a `screens/` file (which is shell-bundle, per that test's own `SHELL`/`GAME`
      split).
- [ ] **Live:** two browsers — the podium and banner render correctly with real Character models.

## Watch out for

**Don't build a second copy of `characterModel.ts`'s GLTF-loading logic for the podium.** Reuse it.

**The podium's own Three.js scene must not become a view into the live Match.** It's a small,
self-contained render (like the artifact's own embedded demo), independent of the actual running
simulation — ticket 09's "no live Match behind the Screen" rule stays intact; this is a *different*,
deliberately separate 3D scene, not an exception to that rule.

**Reuse `matchScore`/`matchWinner` exactly as ticket 06 left them** — the podium and banner are new
presentation over old, already-correct data. Do not recompute placement or Score anywhere in this
ticket; the "no arithmetic in the Screen" rule from ticket 06 still applies.
