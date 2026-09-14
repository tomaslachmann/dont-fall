# 04 — Builder Playtest opens free-roam + live author-to-player proof

**What to build:** Repoint the builder's Playtest button at the free-roam
session (grilled decision 2a): same publish-first flow, but it opens
`/play?track=X&freeroam=1` instead of the match route. Then prove the
whole author loop live.

**Blocked by:** tickets 01–03 (needs the session, its rules, and its HUD).

**Status:** planned

## Why

The button's job is author iteration — build, run, fix — and today it
delivers the author into Lobby ceremony instead. Match-pipeline coverage
doesn't disappear: it stays available through the normal client Play flow
(lobby, Track pick, real server), where the ceremony is legitimate.

## What to change

- [ ] Playtest keeps its publish-first flow (reserved id, same validation)
      and opens `/play?track=X&freeroam=1` — one-line URL change plus any
      status text that still says "match"
- [ ] No second button, no mode toggle in the builder (grilled decision 2a
      — one button, one purpose)
- [ ] Builder `shell.test.ts` conventions hold: no new untested element
      ids (there are none — no new DOM)

## Done when

- [ ] **Live:** from the builder, place all four asset Modules, Save,
      Playtest — spawn is instant, no Lobby/ready/players; run, fall,
      respawn at the Checkpoint, cross the finish zone (toast, keep
      running), Esc back. No falls-through, snags, or visible/physical
      mismatch a Player can feel
- [ ] **Live:** the same Track through normal match Play still works
      unchanged (the ceremony path this ticket bypasses, not breaks) —
      needs a second browser, as before
- [ ] Typecheck clean

## Watch out

- Sandbox note (M8 tickets 02–05): loopback `listen` is EPERM here and no
  browser automation exists, so both live items run on a dev machine, not
  in this sandbox. Everything runnable (suites, typecheck, headless
  session tests) runs here first.
