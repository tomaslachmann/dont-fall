# 03 — Practice HUD and exit (a hint bar, not a match HUD)

**What to build:** The only DOM a free-roam session draws: Track name,
controls hint, Esc-to-exit — plus the finish toast from ticket 02. Plain
DOM like the match HUD (ADR 0008), but a separate small component, never
the match HUD with pieces hidden.

**Blocked by:** ticket 02 (needs the finish event to display).

**Status:** planned

## Why

Grilled decision 4: the match HUD shows things that don't exist here
(Rounds, timer, standings). Rendering it with holes looks like a broken
match; branching inside it for two modes tangles both. A 20-line hint bar
is honest about what a practice session is.

## What to change

- [ ] Practice hint bar: Track name, move/jump/dash hint, "Esc — back to
      menu". Shown for the whole session, dismissed by nothing
- [ ] Finish toast: the ticket-02 finish event renders "Finished — keep
      running" for a few seconds, then fades; running continues underneath
- [ ] Esc (and the existing `onExit` path) tears the session down through
      the same teardown discipline as a match and returns to the menu —
      no new exit mechanism
- [ ] The match HUD is untouched — no shared component, no mode flag
      inside it (agree the ticket-02 finish-event seam, don't both build it)

## Done when

- [ ] Component tests: hint bar renders Track name + hints; finish event
      shows the toast and it fades; exit path disposes the session
      (M4 ticket 01's discipline, asserted not assumed)
- [ ] Typecheck clean

## Watch out

- React owns the shell, the game loop never runs through it (ADR 0008) —
  the toast is an event into React state, not a render call from the loop.
