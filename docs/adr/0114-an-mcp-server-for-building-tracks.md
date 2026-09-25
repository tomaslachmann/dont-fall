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
- A stored draft was unreadable by hand until ADR 0115: the Track builder's
  Browse lists Drafts beside Tracks, opens one, saves back to it and
  playtests it. D9's "drafts live in the API" is what made that possible; the
  gap was only that nothing on the authoring side read `/drafts`.
- Discovery lists at the *palette* level, not the file level: a color family's
  four files are one entry under its canonical, because color is an Attachment
  (ADR 0113) — the level the builder's Assets tab has always shown. The
  shape-level dedup moved out of the builder into shared
  (`assetPaletteIds`/`canonicalPaletteId`), so the tab and `list_modules`
  cannot drift apart. `list_categories` counts shapes to match. Placement is
  untouched: every registry id stays storable, legacy `X_blue` included, and
  `get_module` still answers one (its `family.canonicalId` names the shape to
  place and paint instead). A shape whose colorless twin is its own file lists
  twice — same geometry, different art — told apart by `paintable`.
- `get_character_mechanics` joins the tool list (2026-09-20): geometry is only
  walkable if it was placed within what a Character can reach, and an LLM
  cannot check that by eye. It computes from `tuning/` at call time — walk,
  the jump's apex and gap (integrated at the real tick, with the hold, not
  `v²/2g`), Dash, capsule, slope bands, every Surface's cost, Spring and belt
  speeds, Hit/Grab reach, and a conservative rise/gap `budget` for a route
  everyone must take. Deliberately *not* prose in the skill: feel values are
  tuned by playing, and a number in a document is a number nobody played — the
  Dash was built at 15, recorded as 12 in ADR 0092, and reads 9 in the file
  today. Its tests assert the link to `tuning/`, never a value, because
  asserting a value would be the copy again.
- Two client-side companions, neither part of the server: the repo-root
  `.mcp.json` registers it for every Claude Code session here (checked in,
  so no per-clone setup), and `plugins/dont-fall-track-builder` is a Claude
  Code plugin carrying one skill — the authoring guidance an LLM needs that
  no tool description can hold (placement units, the rest-pose rule, the
  Race/Survival split, publish only when asked). The plugin deliberately
  ships no `.mcp.json` of its own: a second registration would double all 28
  tools for anyone working in the repo. D8 is untouched — the snippet in
  `plugins/dont-fall-track-builder/mcp/` is the same stdio config any other
  client takes.
