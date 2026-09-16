# 0068 — Gates: checkpoints and finishes you pass through, and a Start on any Segment

## Context

A Track's structure still comes from three procedural blocks: `start` (by being
first), `finish` (a Finish Zone box, ADR 0039) and the two `checkpoint-*`
Modules (a trigger box plus a respawn point) — grey boxes in a builder that now
places 456 art Assets. The Asset set already has the shapes a course wants for
this: KayKit hoops (standing and angled) and arches (normal, tall, wide) in four
colours, and two finish signs (`kaykit_signage_finish`, `_wide`).
They sit in Scenery and do nothing.

Settled with the user (2026-09-15), two rounds of questions.

## Decision

- **A new Asset category, `gate`** — KayKit hoops, arches and finish signs,
  all colours (22 Assets). Fences, flags and arrow signs stay Scenery, and so
  does `trap_arch`: despite its name it is a flat outline with no opening a
  Character fits through.
- **Every gate Asset carries an opening, fitted at build time.** A script
  probes the converted collision with rays along a through-direction swept
  about the Asset's X axis (±60°) and keeps the cells a ray passes clean
  through: an opening enclosed on every side (a hoop's ring) wins at the
  direction that maximises it; otherwise the opening is bounded by the floor
  (an arch, a sign's posts) in the upright plane. Stored as a cell mask on the
  Asset's def (a generated file), in the Asset's own frame, with the gate's
  role: `checkpoint` (hoops, arches) or `finish` (finish signs).
- **Passing through** is the Character's capsule centre crossing the opening's
  plane, inside the opening, between one tick and the next — either direction,
  walking or jumping; never around or over the gate. A pure function of
  positions, so a predicting client agrees with the server with no new
  replicated state. A Respawn's teleport never counts as a pass.
- **A hoop or arch is a Checkpoint only when switched on** on the placed
  Segment (`Segment.checkpoint`), carrying a number. Checkpoints count forward
  by number — reaching a higher one moves the Respawn, a lower one never does,
  and skipping is allowed; Results' "furthest" is the highest number reached.
- **Respawn at a gate Checkpoint defaults to the floor just in front of the
  gate** — on the side a runner arrives from (the previous Checkpoint, else the
  spawn), past the gate's whole footprint plus a capsule and a step — and
  behind it when that side is a drop. Found when the Track resolves, from its
  still geometry (the gate's own collision excluded). Never straight under the
  opening: the user found a hoop's Respawn landing on or inside its own post
  (2026-09-15). The author can move it to another spot (stored in the gate
  Segment's own frame, so it follows the gate). A gate with no floor on either
  side and no chosen spot is not a Checkpoint: the Track resolves with a
  warning and the builder shows it.
- **A finish sign is always a Finish Zone** when placed — no switch. Hoops and
  arches are never a finish.
- **`Segment.start`** marks any Segment as the Start, at most one per Track.
  The spawn grid sits on that Segment's deck top, turned with the Segment, and
  Players begin facing its forward. A Track with no Start spawns on its first
  Segment exactly as before (the builder warns).
- **No Motion on a Start, a Checkpoint gate or a finish sign** — publish
  refuses the pair. Spawn grids, openings and respawn floors are resolved once
  from rest geometry.
- **The old blocks retire:** `start`, `finish`, `checkpoint-spinner`,
  `checkpoint-end-props` and `sandbox` join `DEPRECATED_MODULE_IDS` — hidden
  from the palette, still resolving (their trigger boxes still detect by
  containment) with a per-Segment warning naming the replacement, so every
  stored Revision and the seeded M1 playground play exactly as they did.

## Consequences

- Amends ADR 0039: a Finish Zone is a Module trigger box *or* a finish sign's
  opening. Checkpoint gains the gate form beside the legacy trigger box.
- New shared surface: the `gate` category, gate defs, `Segment.start` /
  `Segment.checkpoint` with their validators, the pass-through test, the floor
  probe, `trackSpawn` reading the Start.
- An old Track mixing retired checkpoint Modules and numbered gates orders the
  retired ones first, in Track order, then the gates by number.
- The opening is as fine as the probe grid (0.1 units). A crossing through a
  cell the probe called open is a pass; geometry blocks the rest physically.
- Openings are found only for gates facing ±Z within ±60° of upright —
  every gate in both packs. Another shape would need the probe widened.
- A gate Checkpoint scaled up or down (ADR 0062) scales its opening and its
  chosen respawn spot with it; the default floor is re-found at the new size.
