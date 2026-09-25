# 0115 — The Track builder opens a stored Draft

> Status: Accepted — the user's report on 2026-09-20 ("pres mcp se uklada
> draft co nejde nikde precist pak ani v builderu") and their two picks in
> the question round the same day.

## Context

ADR 0114 D9 put the MCP server's unfinished work in the API
(`track_drafts`), so it survives restarts. Nothing on the authoring side
could read it back: the Track builder's Browse calls `GET /tracks`, and a
Draft is a different table. Only the headless thumbnail page fetched
`/drafts/:id`, for `screenshot_draft` — which is why an LLM could screenshot
its own work but a person could not open it.

So an LLM-built Draft was a dead end: editable only by more MCP calls, and
visible in the builder only by publishing it, which forces half-built work
into a Revision.

The two stores were never two concepts. CONTEXT.md has always defined a
**Draft** as "a Track being composed in the Track builder — mutable, not yet
published"; the MCP's draft is that same thing, kept in the API instead of a
browser tab. The glossary entry now says so.

## Settled decisions

- **D1 — Save writes back to the Draft (user pick, 2026-09-20).** Opening a
  stored Draft puts the builder in Draft editing: SAVE does
  `PUT /drafts/:id/segments` then `PATCH /drafts/:id`. The alternative
  offered — open one-way, SAVE publishes a Revision as before — was declined
  because hand edits would never reach the Draft, so asking the LLM to
  continue would work from a stale copy. Round-tripping is the whole point:
  LLM → person → LLM.
- **D2 — Open only, no new Drafts from the builder (user pick).** The
  builder still creates Tracks the way it always has; a Draft is created by
  the MCP server (`create_draft`). The builder opens, edits, saves and
  playtests one.
- **D3 — A Draft is playtestable (user add: "but I need to be able to test
  run that draft also").** PLAYTEST already publishes whatever Segments are
  on screen to the reserved playtest Track id, so an open Draft playtests
  with no special case. A test pins that, including that the Draft stays the
  thing being edited afterwards.
- **D4 — Leaving a Draft keeps the Segments.** CLOSE DRAFT is about where
  SAVE goes, never about discarding work: the Segments stay on screen and
  SAVE publishes a Revision again. Nothing in the builder deletes a Draft —
  `discard_draft` stays the MCP server's, and the user's own instruction to
  it is the only thing that throws one away.

## Decision

Browse lists stored Drafts above the Tracks (one round trip, `GET /tracks` +
`GET /drafts`), opening one adopts it exactly as a Revision is adopted, and
while it is open SAVE writes back to it. A Draft carries the same publish
metadata a Revision does, so the toolbar's fields seed from whichever is
open — plus `roundType`, which the builder has no notion of (a Round type is
picked in the Lobby, ADR 0041) and therefore carries untouched rather than
dropping on save.

## Consequences

- A person and an LLM now edit one artifact. The MCP server's `list_drafts`
  and the builder's Browse show the same rows.
- Two save meanings exist in one toolbar. They are never both live: SAVE
  reads "SAVE DRAFT" while a Draft is open, and there is an explicit way out.
- Saving a Draft skips Thumbnail capture — a Draft has no thumbnail column,
  because framing one is a publish's job (ADR 0085). One fewer step while
  iterating, and `publish_draft` still produces a thumbnail-less Revision
  exactly as before.
- Unlike a Revision, an empty Draft saves without complaint: half-built is
  what a Draft is for (ADR 0114 D4).
- `loadTrackById` and `loadDraftById` share one `adoptTrack` — the
  unknown-Module warning, the Environment fallback, asset visuals, framing
  and selection reset are written once, so the two load paths cannot drift.
