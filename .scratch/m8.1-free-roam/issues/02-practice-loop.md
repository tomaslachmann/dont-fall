# 02 — Practice loop and session rules (run, fall, checkpoint, finish, repeat)

**What to build:** The per-tick heart of free-roam: local inputs drive the
local sim at the fixed 30 Hz step, falls respawn at checkpoints, crossing
the finish zone says so and lets you keep running. No timer, no Rounds, no
results, no input lock — ever.

**Blocked by:** ticket 01 (needs the practice world to step).

**Status:** planned

## Why

Grilled decision 3: checkpoint respawn with match logic, finish that
reports instead of ending. The author tests section-by-section (fall →
checkpoint → next section) and verifies completability in a single run.
Anything less (spawn-only respawn, dead finish) makes end-of-Track
iteration miserable; anything more (timer, qualification) rebuilds the
ceremony this milestone removes.

## What to change

- [ ] Fixed-step local loop (30 Hz, ADR 0004 — same invariant as
      everything else): keyboard inputs → sim step → render. Reuse the
      input mapping match play uses (move, jump, dash), not a second one
- [ ] Fall/void respawn through the match checkpoint logic (last
      Checkpoint trigger, else spawn) — shared code, never a parallel
      implementation
- [ ] Finish-zone crossing raises a "Finished — keep running" event to the
      HUD and changes nothing else: no `finishTick` lock, no phase change,
      no results computation
- [ ] Speed/slow pads, bounce/launch pads, Volumes, ice/mud behave as
      simulated — they are sim features, so they arrive for free; verify,
      don't rebuild (a headless walk over each is enough)

## Done when

- [ ] Headless session test: scripted inputs spawn, run, fall, respawn at
      the Checkpoint (not the spawn), cross the finish zone and keep
      moving — with zero socket traffic and zero Round/phase machinery
- [ ] Typecheck clean

## Watch out

- The sim is the same `RapierSimulation` the server runs — if practice and
  match ever disagree on a Track, that's a shared-codeshape bug, and this
  ticket's cross-check (same bytes in, same positions out) is where it
  gets caught, not worked around.
- No timer means no timeLeftMs: the HUD must never read match-only fields
  (ticket 03 owns that split — agree the seam, don't both build it).
