# 05 — `/assets` answers with cache validators and one copy of the bytes

**What to build:** the API's asset route sends `ETag` (content hash) and
`Cache-Control: no-cache` so browsers revalidate and get `304` for unchanged
files, and stops copying each file twice (`readFile` → `Uint8Array` →
`Buffer.from`); optionally an in-memory cache of hashes keyed by mtime.

**Decided:** not yet — proposal (option C).

**Status:** proposal

## Why

The API sent 2.13 GB in ~40 min of dev: every builder load, game entry and host
`apps/server` restart downloads all 101 MB again (no validators today), and the
double copy per file churns Buffers under glibc
(`docs/research/memory-bloat-investigation.md`).

## How it behaves after

- A reload of the builder or the game re-validates each file and receives
  `304 Not Modified` bodies — near-zero bytes — unless the art changed.
- A changed file (reconverted Asset) gets a new ETag and is downloaded fresh:
  floating revisions (ADR 0050) keep working, no stale art.
- Node loaders (the Match server's `fetch`) have no HTTP cache and behave as
  today; ticket 01/06 cover them.

## Checklist

- [ ] ETag + `Cache-Control: no-cache`, `If-None-Match` → 304 (glb/png/jpg)
- [ ] Single copy of the bytes per response
- [ ] Controller tests: 200 with ETag, 304 on match, 200 after the file changes
