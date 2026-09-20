# @dont-fall/mcp-track-builder

Build DON'T FALL Tracks through an LLM (ADR 0114): a stdio, tools-only MCP
server — any MCP client drives it. Drafts live on the track API, so
unfinished work survives restarts; discovery reads the version-locked
`@dont-fall/shared` registry.

## Run it

The API must be up first — `pnpm dev --mcp` from the repo root starts it
plus the builder (which `screenshot_draft` needs) and prints the client
config below with the right `cwd`. Then point the MCP client at this
package:

```json
{
  "mcpServers": {
    "dont-fall-track-builder": {
      "command": "pnpm",
      "args": ["--filter", "@dont-fall/mcp-track-builder", "start"],
      "cwd": "/path/to/game",
      "env": { "TRACK_API_URL": "http://localhost:8081" }
    }
  }
}
```

Environment:

| Variable | Default | What |
|---|---|---|
| `TRACK_API_URL` | `http://localhost:8081` | The API drafts live on |
| `THUMBNAIL_PAGE_URL` | `http://localhost:5174/thumbnail.html` | Builder dev server page `screenshot_draft` renders through |
| `CHROME_PATH` | macOS Chrome | Headless Chrome for `screenshot_draft` |

`screenshot_draft` needs the builder's dev server
(`pnpm --filter @dont-fall/track-builder dev`) besides the API. Without it
that one tool answers how to set it up; everything else works.

## The tools

- Discover, staged: `list_categories` → `list_modules` → `get_module`,
  plus `list_procedural_modules`, `list_attachments`, `list_tracks`,
  `get_track` (paged).
- Drafts: `create_draft` (empty / explicit / `from` a Revision),
  `list_drafts`, `get_draft` (paged), `add_segment(s)`,
  `update_segment(s)`, `remove_segment(s)`, `set_draft_meta`,
  `discard_draft`. Every write is atomic — one bad entry writes nothing.
- Sugar, all over index lists: `set_surface`, `set_motion`,
  `set_conveyor`, `set_launch`, `set_prop`, `set_paint`, `set_course`.
- Gate: `validate_draft` (round-type-aware; errors refuse a publish,
  warnings deserve a look), `screenshot_draft` (the visual backstop).
- `publish_draft`: a valid draft becomes a Revision — a new Track id, or a
  new Revision of an existing one. The draft survives to publish again.

Every tool answers JSON (`{ error }` with `isError` on failure, the API's
own message when it refused) except `screenshot_draft`, which answers the
JPEG as an image block plus a caption.

## Develop

```sh
pnpm --filter @dont-fall/mcp-track-builder test
pnpm --filter @dont-fall/mcp-track-builder typecheck
```

Tests drive the real protocol (in-memory client↔server) against a real API
over real HTTP; the headless renderer is stubbed — real Chrome never boots
in a test.
