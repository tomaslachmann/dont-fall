# 12 — Standings redone: the artifact's Results design, the Ready gate, independent Match-end exit

**What to build:** Rebuild `StandingsScreen` to actually match the confirmed artifact design
(<https://claude.ai/code/artifact/6f59296b-63c8-48ae-937e-88a43b15e9f4?org=51b43cec-3008-499c-adb6-1ae9a8b9abae>)
for the "Round just played" portion — podium + personal outcome banner — keep the Match Score list
ticket 06 already built (no artifact analog; it postdates the artifact), wire in the Ready button
(ticket 10) between Rounds, and replace the host-only Match-end "Back to Lobby" with a per-Player,
independent "Main Menu" action.

**Blocked by:** ticket 09 (non-live surface), ticket 10 (the Ready message this screen sends),
ticket 11 (Loading is what Ready hands off to).

**Status:** not started

## Why

A live audit (this session) found `StandingsScreen` as shipped by ticket 06 doesn't match the
confirmed artifact at all: a flat `#N` list, no podium, no personal banner. ADR 0051 separately
changes both the between-Round and Match-end behavior. Both corrections land on the same component,
so one ticket, not two.

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
- [ ] **Between-Round footer.** Replace "More Rounds to play — advancing automatically…" with a
      "Ready for next Round" button (ticket 10's `StandingsReadyMessage`) plus a simple per-Player
      confirmed/not-yet indicator, reusing the Lobby's own Ready-list visual language (`Row` +
      `ActivityDot`/similar) rather than inventing a new one. Sending it hands off to `LoadingScreen`
      (ticket 11).
- [ ] **Match-end footer.** Replace the host-only `onReturnToLobby`/"Back to Lobby" with an
      unconditional "Main Menu" action any Player can click independently, wired like today's
      `onExit`/`onMatchEnd` hand-off — not like the retired `returnToLobby`.
- [ ] **DNF row border color.** The artifact leaves a DNF row's border unrecolored (dashed only);
      real `Row.dnf` currently recolors it to `--df-color-fall` (orange) — an undocumented deviation
      the audit flagged specifically. Reconcile in `packages/ui`'s `Row.module.css`.

## Done when

- [ ] Component tests: podium renders (including the SVG-silhouette fallback path, testable without
      a real WebGL context), `<PersonalResultBanner>` shows the right outcome, the Ready button
      fires the new message and shows per-Player confirmation state, the Match-end Main Menu button
      is available to every Player (not just the host) and fires independently of the others.
- [ ] `codeSplitBoundary.test.ts` still holds — the podium's Three.js usage goes through the same
      dynamic-import boundary `GameCanvas.tsx` already uses for `game/index.js`, never a static
      import from a `screens/` file (which is shell-bundle, per that test's own `SHELL`/`GAME`
      split).
- [ ] **Live:** two browsers — the podium and banner render correctly with real Character models;
      clicking Ready on one browser does not advance the other until it also clicks (or the timeout
      fires); at Match end each browser independently leaves to the Main Menu without affecting the
      other.

## Watch out for

**Don't build a second copy of `characterModel.ts`'s GLTF-loading logic for the podium.** Reuse it.

**The podium's own Three.js scene must not become a view into the live Match.** It's a small,
self-contained render (like the artifact's own embedded demo), independent of the actual running
simulation — ticket 09's "no live Match behind the Screen" rule stays intact; this is a *different*,
deliberately separate 3D scene, not an exception to that rule.

**Reuse `matchScore`/`matchWinner` exactly as ticket 06 left them** — the podium and banner are new
presentation over old, already-correct data. Do not recompute placement or Score anywhere in this
ticket; the "no arithmetic in the Screen" rule from ticket 06 still applies.
