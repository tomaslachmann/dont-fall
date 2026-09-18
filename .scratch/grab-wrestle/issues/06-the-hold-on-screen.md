# 06 — The hold on screen

**What to build:** The held Player sees the `Grabbed.tsx` mock over the live game, with the keys to
wiggle and the escape meter. The grabber sees a compact bottom-centre panel with the held Player's
meter, the time left and what to press, including the wind-up while Spinning. ADR 0104,
"On screen".

**Blocked by:** 02 (meter), 03 (Limp text), 04 (wind-up)

**Status:** done on tests (2026-09-18) — every live check is the user's

- [x] Held Player, Struggle: the mock's column over the live game, with no Stage background (ADR 0060)
      and a Danger vignette at the edges: `{GRABBER} HAS YOU / GRABBED / MASH {left} {right} TO
      BREAK FREE`, the escape meter, and a thin bar for the window. The keys come from the Player's
      bindings (`controlLabel`, short)
- [x] Held Player, Limp: `KNOCKED OUT — {GRABBER} IS CARRYING YOU`, no prompt
- [x] Grabber, bottom centre and compact: `YOU HAVE {NAME}`, the held Player's escape meter and time
      left, and prompts from the bindings: `HOLD {hit} SPIN · RELEASE HURL · {grab} LET GO`. While
      Spinning: the wind-up bar with a red overspin zone past full
- [x] Fed through the Round HUD's snapshot (ADR 0088): display-rounded (meter and bars to
      twentieths, as the Dash meter), raised only when they change. Both Race and Survival HUDs
      show it
- [x] The Danger vignette is rebuilt from the mock (`ui/Vignette.tsx` was deleted in the subtraction
      pass)
- [x] Tests: `roundHud` derives both panels (Held Struggle, Held Limp, grabbing, Spinning) and the
      rounding; the prompt reads the bound keys, and an unbound action shows `—`

## As built

Corrected the same day, at the user's word: the design in `test_components` is the finished
app, so it is used as it is.
- `Grabbed` is the mock ported 1:1 (identical CSS; `Danger` restored to `ui/Vignette.tsx` from
  git). There is no Stage background (ADR 0060) and no time bar. Limp keeps the column with the
  prompt "KNOCKED OUT" and no meter.
- `HoldingPanel` is assembled from the design's own pieces, class for class: `Ragdoll`'s get-up
  block (header, bar, a timer chip), `Spectator`'s key pills (`keyCap` + `keyLabel`) for F and G,
  and `DashFeedback`'s charge card (pips, a halo once full) for the wind-up.
