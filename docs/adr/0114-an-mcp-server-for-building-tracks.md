# 0114 — An MCP server for building Tracks

> Status: Final — accepted by the user on 2026-09-20 with the words "ok,
> ale jeste bulk akce v set_motion, place atd..." (recorded as D11 above;
> the tool list includes the bulk amendment).

## Context

The user wants to build Tracks through an LLM ("at muzu stavet pres llm
drahy") and asked for a decision interview about what the MCP server should
contain before anything is implemented.

## Settled decisions

- **D1 — The flow (user picked option 1, 2026-09-20).** The user prompts an
  LLM in a chat client; the LLM calls MCP tools; the finished Track lands as
  a Revision on the track API, ready to open in the track-builder or play.
  The MCP server does not drive the running builder UI.
- **D2 — Authoring level: raw Segments (user pick, 2026-09-20).** Tools read
  and write `Segment` JSON (`moduleId`/`position`/`rotation`/attachments) —
  no block-level helpers. The LLM must know the Module registry.
- **D3 — Discovery: full registry depth, staged in steps (user pick: option
  1 "ve více krocích", 2026-09-20).** No single giant dump: the LLM walks
  groups/categories → modules → full detail (footprint, sockets, surface,
  color family, attachment reference) progressively.
- **D4 — Server-side drafts + per-segment ops (user pick: option 1,
  2026-09-20).** The server holds the unfinished Track: create draft (from
  scratch / from an existing track+revision), add/update/remove segments,
  paged reads — no full-JSON round-trips per edit.
- **D5 — `validate` tool + publish gate, round-type-aware (user pick: option
  1 + "máme 2 druhy", 2026-09-20).** Fast try-check-fix loop without
  publishing halves; publish refuses invalid. Rules differ per round type:
  Race (start/checkpoints/finish) vs Survival (arena, survivor target, no
  finish).
- **D6 — Sugar tools for attachments alongside raw edits (user pick: option
  2, 2026-09-20).** `set_surface`/`set_motion`/`set_conveyor`/… next to raw
  `add`/`update_segment`. Boundary with D2: placement stays raw
  (moduleId/position/rotation, no layout helpers), attachments get explicit
  validated tools.
- **D7 — Free publish (user pick: option 1, 2026-09-20).** New track ids and
  new revisions of existing tracks, no confirmation gate. Local tool, the
  user watches the chat; revisions are cheap (every builder save is one too).
- **D8 — stdio, client-agnostic standard MCP (user pick: option 1 "ale ne
  jen pro claudea", 2026-09-20).** Any MCP client (Claude Code, Cursor, VS
  Code…), no client-specific coupling — which also means tools-only, no
  exotic protocol features some clients lack.
- **D9 — Drafts live in the API (user pick: option 3, 2026-09-20).** New
  draft endpoints on the track API hold the unfinished Track (segments +
  publish metadata: name, round type, time limit, survivor target,
  environment); the MCP server is a thin client over them. Survives any
  restart by construction.
- **D10 — `screenshot_draft` tool (user add, 2026-09-20).** Renders the
  draft headlessly (the thumbnail pipeline's machinery) and returns the
  image to the LLM as a second validation backstop beside `validate`.
- **D11 — Bulk actions (user add: "ok, ale jeste bulk akce v set_motion,
  place atd...", 2026-09-20).** Batch placement (`add_segments`) and batch
  edits (`update_segments`, `remove_segments`); every sugar tool takes
  segment index list(s), never a single index. Batches are atomic —
  all-or-nothing per call.

## Interview trail (all settled 2026-09-20)

Q1 transport → D8 · Q2 discovery → D3 · Q3 draft state → D4 · Q4
validation → D5 · Q5 surfaces → D6 · Q6 publish → D7 · Q7
persistence → D9. D1 (flow) and D2 (raw level) were picked in the opening
round; D10 (screenshot) and D11 (bulk) are user adds.

## Tool list

Discover (staged, D3): `list_categories`, `list_modules`,
`get_module`, `list_attachments`, `list_tracks`, `get_track`.
Drafts (API-side, D4+D9): `create_draft`, `get_draft` (paged),
`add_segment`/`add_segments`, `update_segment`/`update_segments`,
`remove_segment`/`remove_segments`, `set_draft_meta`, `discard_draft`.
Sugar (D6+D11, all index-list based): `set_surface`, `set_motion`,
`set_conveyor`, `set_launch`, `set_prop`, `set_paint`, `set_course`.
Validation (D5+D10): `validate_draft` (round-type-aware),
`screenshot_draft`. Publish (D7): `publish_draft` (new id or revision).

## Scope contract (accepted)

- **This interview delivered:** ADR 0114 accepted (Final) with the tool list
  above. Nothing else.
- **A later implementation would contain:** a new MCP server package
  (stdio, tools-only), new track-draft endpoints on the API, headless
  draft rendering for `screenshot_draft`, and tests. Accepting this ADR
  approves the design only — implementation needs a separate explicit
  request.
- **Non-goals:** layout/placement helpers (D2), walkability simulation as a
  gate (D5), driving the live builder UI (D1), HTTP transport (D8),
  auth/multi-user (local tool).

## Decision

Build the MCP server per D1–D11 and the tool list above: a stdio,
client-agnostic, tools-only server; staged discovery; API-side drafts with
raw + bulk + sugar edits; round-type-aware `validate` plus `screenshot` as
the backstop; free publish to new ids or revisions.

## As built (2026-09-20)

- `list_drafts` joins the tool list: resuming work needs the drafts without
  their Segments, and no listed tool answered that.
- Every tool answers JSON (`{ error }` with `isError` on failure); only
  `screenshot_draft` answers pixels (an image block plus a caption).
- `validate` warns where it cannot refuse: a launch on no Spring, a finish
  sign in a Survival draft, a Race without Checkpoints, skipped Checkpoint
  orders. Publish refuses on validate's own errors, then copies the draft
  into `POST /tracks` — no thumbnail (framing one is the builder's
  capture, not this tool's).
- `screenshot_draft` renders through the builder's dev server
  (`THUMBNAIL_PAGE_URL`, default `:5174/thumbnail.html`) and headless
  Chrome (`CHROME_PATH`); one browser per call. The thumbnail page gained
  a `?draft=&api=` mode with a whole-bbox auto-frame — a long Race reads
  as an overview.
- Per-segment edits are read-modify-write over `PUT /drafts/:id/segments`:
  one PUT per call is what makes every batch atomic.
