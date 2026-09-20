# 02 — MCP server scaffold and discovery

**What to build:** New workspace package with a stdio, tools-only MCP server
(client-agnostic per D8 — no client-specific features), a thin client over the
track API (`TRACK_API_URL`, default localhost:8081). Staged discovery (D3):
`list_categories`, `list_modules` (by category, paged), `get_module` (full
def: footprint, sockets, surface, color family, launch/hazard/gate),
`list_attachments` (attachment reference: fields + allowed values),
`list_tracks`, `get_track` (existing tracks as templates). ADR 0114, D1+D3+D8.

**Blocked by:** — (consumes ticket 01's endpoints from ticket 03 on)

**Status:** planned

- [ ] Package scaffold: manifest, entry, stdio transport, tool router + tests
- [ ] Discovery tools reading the registry + track API, paged, no giant dumps
- [ ] `get_track` returns segments (paged) + metadata for use as a draft source
- [ ] Tests: every discovery tool against a real API (in-process app.inject)
