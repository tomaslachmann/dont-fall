---
name: dont-fall-track-builder
description: Build, inspect, edit, validate, screenshot and publish DON'T FALL race and survival Tracks through the dont-fall-track-builder MCP server. Use when the user wants a new Track, a change to an existing one, a Track branched or copied, a draft resumed, or a draft published as a Revision.
---

# DON'T FALL Track Builder

Drive the `dont-fall-track-builder` MCP server (ADR 0114) whenever the user wants to
create, inspect, modify, validate, visualize, or publish a DON'T FALL Track.

## Prerequisites

The server is a thin client over the track API, so the API must be running: `pnpm dev --mcp`
from the repo root starts it (`:8081`) plus the Track builder (`:5174`), which
`screenshot_draft` renders through.

If every tool fails to reach the API, say so and name that command — do not keep retrying.
If only `screenshot_draft` reports rendering unavailable, the builder's dev server is down:
carry on with `validate_draft` and tell the user the visual backstop is missing.

## Discovery

Do not guess module IDs. Walk the registry in stages:

1. `list_categories` — the Asset groups with counts.
2. `list_modules` — summaries in one category: size in metres, deck top, socket count.
3. `get_module` — the full def: footprint, sockets, default surface, hazard, spring launch.

`list_procedural_modules` only for the legacy M1 pieces (ADR 0078: the builder places Assets).
`list_attachments` when an attachment's value shape is unclear, and `get_character_mechanics`
for what a Character can reach (see below).

Read only what you need — a Track's Segments and a module's full def are both large.

### Color is paint, not a Module

`list_modules` lists one entry per **shape**, the same level the builder's Assets tab shows —
a `6x6` platform is one entry, not four. A `paintable` shape wears any of the 8 hues through
the `color` Attachment: place the listed id and `set_paint` it (or pass `color` on the Segment
when you add it). Red/blue/green/yellow wear authored files, the other four tint flat.

So do not go looking for a `..._blue` module id. Those ids still exist and still place — older
Tracks are full of them — but they are the same shape, and `get_module` on one points back at
the shape to place instead.

## Placement contract

Placement is raw (ADR 0114 D2) — there are no layout helpers, so you own the geometry:

- `position` is a world point in **metres**; KayKit Assets sit **on** `y=0`, nothing hangs below.
- `rotation` is **world yaw in radians**; a course chains toward **−Z**.
- `pitch` / `roll` are additive radians; `scale` is uniform.
- Use `get_module`'s size and sockets to butt pieces together — no piece inside another
  (ADR 0106; `validate_draft` does not check overlaps, your eyes on `screenshot_draft` do).

## What a Character can do

Geometry only works if it is reachable, so **call `get_character_mechanics` before placing
anything that has to be traversed.** It computes from `packages/shared/src/tuning/` at call
time — the same constants the simulation runs — and answers walk speed, the jump's apex and
the gap it crosses, Dash, capsule size, slope bands, every Surface's cost, Spring and belt
speeds, Hit and Grab reach, and a `budget` for a route every Player must take.

Do not carry a number over from here, from an ADR, or from a chat message. Feel values are
tuned by playing and are not settled: the Dash was built at 15 u/s, written down as 12, and
is something else today. The tool is the only honest source.

What does not change with tuning, and is what geometry has to respect:

- **No autostep.** Any lip is a wall that must be jumped, however small. A pad or plate has
  to be *seated* — sunk into its deck until it stands about 2 cm proud — or it blocks the
  Character instead of triggering.
- **No crouch, no double jump.** A bar to pass under needs more than the capsule's full
  height of clearance; a ledge out of jump reach is out of reach, full stop.
- **Slopes fall in three bands** — walkable, Sliding, wall. The tool gives the two angles;
  an incline between them is a slide, not a path.
- **A belt running against the route beats walking** at its faster presets: that is a wall,
  not a hard section.
- **Size a required route against the tool's `budget`** (the plain tap jump on a default
  Surface). Held jumps, Dash distance, bounce decks and Springs are headroom for optional or
  risky lines, never for the path everyone has to take.
- **Every Surface costs or gives something.** Mud and ice cut speed and jump and can put a
  Character down; a bounce deck throws it higher. A deck that has to be jumped out of should
  be checked against that Surface's own numbers, not the default ones.
- **A Survival arena needs its edge within about a Hit's reach of a line Players walk**, or
  nobody can be shoved off it.

The scripted walkers in `packages/shared/src/track/walkTrack.ts` are what prove an authored
Track is completable end to end.

## Existing Tracks

`list_tracks` and `get_track` (paged) when the user wants to inspect, copy, branch, or modify
a published Track. To edit one, branch it: `create_draft` with its `from` source.

## Draft workflow

Everything under construction is a draft on the API, so it survives restarts.

- `create_draft` (empty, explicit Segments, or `from` a Revision), `list_drafts`, `get_draft` (paged).
- Resume a relevant existing draft instead of creating a duplicate — check `list_drafts` first.
- Prefer the bulk tools: `add_segments`, `update_segments`, `remove_segments`. Each call is
  atomic — one bad entry writes nothing.
- Indices shift: `remove_segment(s)` slides later Segments down, so re-read before the next
  indexed edit.
- `set_draft_meta` carries what the Revision publishes with: `name`, `roundType`,
  `timeLimitMs`, `survivorTarget`, `environment` (`day` / `sunset` / `night`, ADR 0074).
- A Draft is not private to you: the user can open it in the Track builder's BROWSE panel,
  edit it by hand, save it back and playtest it (ADR 0115). So name a Draft something they
  will recognise, and re-read it with `get_draft` before continuing — what is stored may have
  changed since your last call.

## Higher-level editing

Express intent through the semantic tools rather than reproducing them as raw patches:
`set_surface`, `set_motion`, `set_conveyor`, `set_launch`, `set_prop`, `set_bomb`, `set_paint`,
`set_course`. All of them take index lists.

Rules they enforce or that the game assumes:

- One deck, one Surface (ice / mud / bounce) — and none beside a Prop.
- A Prop is nothing else: no behavioural attachment rides with it, only `set_paint` — and a
  bomb's `set_bomb`.
- A bomb (`bomb_A`, `bomb_B`) is always a Prop: picking it up lights it, it goes off wherever
  it is, and it returns where it was placed. Put them where a Player can reach them, and where
  a blast throws people somewhere that matters.
- Only Springs actually throw; a `launch` elsewhere is stored and ignored (validate warns).
- **Rest-pose rule:** with its Motion stopped the course stays walkable, so never centre a
  sweeping bar on the deck it sweeps.
- A Start, a Checkpoint and a finish sign stay still — do not give them a Motion.
- `set_course` marks the Start (one per Track), Checkpoint orders, or clears marks.
  Do not invent Checkpoint ordering — ask, or follow the course's own direction.

## Track quality loop

After meaningful structural changes:

1. `validate_draft` — errors refuse a publish, warnings deserve a look.
2. Fix the errors.
3. `screenshot_draft` — the visual backstop.
4. Look at it: gaps, overlaps, pieces floating or buried, the overall shape.
5. Fix what you see.
6. Validate again.

Report what the screenshot actually shows. If the render is unavailable, say the check is
missing rather than implying the Track was inspected.

## Race Tracks

A Race must validate. It needs a Start and a Finish Zone; Checkpoints are optional but a Race
without them restarts every fall at the Start (validate warns). Give it a `timeLimitMs`.

## Survival Tracks

Respect the draft's `roundType`. Survival needs no finish — a finish sign there is only visual
(validate warns). Set a `survivorTarget`. Do not force Race structure onto an arena.

## Publishing

Use `publish_draft` only when the user explicitly asks to publish, finalize, save as a
published Track, or create a Revision. Before publishing: validate, resolve every error, and
look at the latest screenshot when rendering is available.

Publishing either creates a new Track id or a new Revision of an existing one — say which.
The draft survives, so further revisions continue from it. Published Revisions carry no
thumbnail; that is the builder's own capture (`pnpm render:thumbnails`).

## Safety

- Never `discard_draft` unless the user explicitly asks for deletion.
- Never overwrite or reset an existing draft id, or publish over an existing Track id, unless
  that is clearly what was asked.
