# 05 — Builder: Start, Checkpoint and finish authoring

**What to build:** the inspector and viewport for ADR 0068.

**Blocked by:** 01, 03.

**Status:** done (2026-09-15) — tests and typecheck; the visual check is the user's (they declined a screenshot pass)

## How it behaves after

- **Inspector, any Segment:** a **Start** switch. Switching it on moves the
  Start here (from wherever it was). Disabled, with the reason, on a moving
  Segment. No Start on the Track → a warning in the status bar.
- **Inspector, hoop / arch:** a **Checkpoint** switch; on, it takes the next
  free number, shown with − / + to renumber (swapping with the gate that had
  it). A **Respawn** row: "in front" of the gate (default) or the chosen spot,
  with **Pick spot** (click a platform) and back to **In front**. No floor and
  no spot → the card turns pink with the reason.
- **Inspector, finish sign:** a FINISH chip, no switch.
- **Viewport:** the opening outlined on every gate (green Checkpoint with its
  number, gold finish, grey for a hoop/arch that's off); a respawn marker for
  each Checkpoint; the spawn grid ghost on the Start.
- Motion can't be switched on for a Start, a Checkpoint gate or a finish sign
  (the Motion panel says why).

## Checklist

- [x] Engine actions: setStart, setCheckpoint(order), renumber, pick/reset respawn
- [x] Inspector panels + Motion gating
- [x] Viewport overlays
- [x] Tests for the engine rules (move Start, next free number, swap on renumber)

## The visual language (user: "hezky designově do naší aplikace")

- One definition, `src/lib/course.ts`, clear of the Impact colours' meanings:
  **Start** is the kit's go green with ▶, a **Checkpoint** the brand purple
  with its Fredoka numeral, **Finish** the racing chequer in ink, a stranded
  Checkpoint danger pink. Never colour alone — every mark carries its word or
  number.
- **Viewport** (`scene/courseOverlay.ts`): spawn-grid slots and a facing
  chevron on the Start's deck with a START pill; each Checkpoint's opening
  filled purple with an outline, a numbered plastic badge above the gate, a
  floor ring + dashed drop line where its Respawn stands; a finish sign's
  opening chequered with a FINISH pill; faint outlines on hoops/arches that
  aren't Checkpoints; a dashed run line Start → 1 → 2 → … → Finish. Labels
  are canvas sprites drawn like kit chips (fill over a zero-blur bevel, white
  rim), screen-constant, redrawn once the web fonts land. Markers follow their
  Segment's group every frame, so a drag carries them.
- **Run order strip** under the transport: RUN ORDER ▶START – ① – ② – ⚑FINISH;
  every stop selects its Segment; a missing Start reads FIRST PIECE (dashed), a
  missing finish NO FINISH (dashed pink), a stranded Checkpoint turns pink.
- **Inspector Course panel** under Transform: MAKE START / MOVE START HERE, a
  green START card; MAKE CHECKPOINT n, a purple card with its big numeral,
  ‹ n / N › order stepper, RESPAWN IN FRONT | ⌖ PICK A SPOT; a chequered FINISH
  card on finish signs; MOTION OFF note (the Motion editor hides for them).

## Notes

- Respawn default moved from "under the opening" to "just in front of the
  gate" after the user found a hoop's Respawn landing on its own post
  (2026-09-15) — shared `gateCheckpointPlans` so the game and this preview
  look in the same places.
- An engine test left hundreds of background asset fetches running into the
  next tests; it now waits for its load to settle.
