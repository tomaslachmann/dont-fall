# 06 — Restore `PlayRoute`'s practice/Match branching

**What to build:** Whatever the new `/play` route ends up rendering (per ticket 05), it must
still branch on `?track=&freeroam=1` into either a local practice session or a real Match
connection through `<GameCanvas>`, exactly as the current (undiffed) `PlayRoute` does.

**Blocked by:** ticket 05.

**Status:** planned

## Why

The uncommitted `App.tsx` diff replaces `<Route path="/play" element={<PlayRoute />} />` with
`<Route path="/play" element={<Lobby />} />` — the `test_components` mock, with no props, no
`useSearchParams`, no `trackId`/`practice` awareness. `PlayRoute` is left as dead code in the
file, never referenced. Since `<GameCanvas>` only ever mounts inside `PlayRoute`
(`apps/client/src/App.tsx:44-72` in the pre-diff file), this doesn't wire anything in — it deletes
the only place the whole simulation/render/network stack mounts. It breaks free-roam practice
(already shipped, M8.1) and real multiplayer Match play simultaneously: no socket opens, no
`LobbyScreen`/`StandingsScreen`/`LoadingScreen` ever render (they only render inside
`GameCanvas`, driven by its `onLobbyState`/`onStandings` callbacks), and the Track builder's
Playtest button (M8.1 ticket 04, already live, opens `/play?track=X&freeroam=1`) lands the author
on a fake lobby with fabricated players instead of their Track.

See `docs/research/test-components-design-screens-gap-analysis.md`, "M8.1 free-roam impact" —
read this section in full before touching `App.tsx`.

## What to change

- [ ] `App.tsx`'s `/play` route keeps `PlayRoute`'s param-parsing and practice/Match branching
      (`parsePlayParams`, the `?freeroam=1` check) exactly as before
- [ ] The reskinned `LobbyScreen` (ticket 05) and `PracticeHud` still mount exactly where they do
      today — inside `<GameCanvas>`, driven by its snapshot callbacks — not as standalone routes
- [ ] Remove `test_components/src/screens/Lobby.tsx` (and any other test_components screen) from
      `App.tsx`'s route table entirely; test_components is a design reference, not a router target

## Done when

- [ ] `?track=X&freeroam=1` boots the local practice session with zero socket traffic, exactly as
      M8.1 ticket 01's "Done when" specified (re-verify, don't just trust the old commit)
- [ ] A plain `/play?track=X` (no freeroam) opens a real Match connection, live-verified with two
      browsers
- [ ] Typecheck clean; `apps/client/src/game/practice.ts`'s test suite and `PracticeHud`'s test
      suite both still pass

## Watch out

- This ticket exists specifically because a naive route swap silently deletes a shipped feature.
  Diff `App.tsx` against `main`/HEAD before finishing, not just against the current working tree,
  to confirm `PlayRoute`'s logic survived intact.
