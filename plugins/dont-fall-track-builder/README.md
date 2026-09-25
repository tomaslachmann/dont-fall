# dont-fall-track-builder (Claude Code plugin)

The skill that teaches an agent to drive the `dont-fall-track-builder` MCP server
(`apps/mcp-track-builder`, ADR 0114): staged Module discovery, API-side drafts with bulk and
sugar edits, the `validate_draft` → `screenshot_draft` loop, and publishing a Revision.

## Install

From a clone of this repo:

```sh
claude plugin marketplace add ./
claude plugin install dont-fall-track-builder@dont-fall --scope project
```

Once per machine: `--scope project` writes `.claude/settings.json`, which this repo gitignores,
so a clone gets the plugin's *files* but not its enablement — run those two commands there too.
The repo-root `.mcp.json` below is checked in, so the server needs no such step.

## The MCP server it drives

The plugin ships the **skill only**. The server is registered separately, on purpose — the
repo's own `.mcp.json` already provides it, and a second copy inside the plugin would register
the same 28 tools twice for anyone working in the repo.

- **Working in this repo:** nothing to do. `.mcp.json` at the repo root registers
  `dont-fall-track-builder` for every Claude Code session here.
- **Working anywhere else** (or another MCP client — Cursor, VS Code, ChatGPT/Codex):
  `mcp/dont-fall-track-builder.json` is the snippet. Replace `cwd` with the absolute path to
  your clone.

The server is stdio and client-agnostic (ADR 0114 D8), so the same snippet fits any client.

## Prerequisites

The server is a thin client over the track API, and `screenshot_draft` renders through the
Track builder's dev server. Start both:

```sh
pnpm dev --mcp
```

That prints the client config with the right `cwd` filled in, and waits until the API
(`:8081`) and the builder (`:5174`) answer.

Without the API, every tool fails. Without the builder, only `screenshot_draft` does.
