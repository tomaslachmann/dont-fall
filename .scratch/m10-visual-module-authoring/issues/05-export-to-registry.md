# 05 — Export to registry

**What to build:** The bridge out of the builder: serialize a composed draft
to a registry-ready Module snippet (copy/download), plus paste-target docs
and validation proving the snippet is what the registry expects.

**Blocked by:** 04 (the export must carry every field the panel can set).

**Status:** planned.

## Why

A Module that lives only in the builder is a demo, not content. The
registry is compile-time TS on purpose (server, predicting client, builder,
and publish validation all import the same ids) — so the compose mode ends
in export-and-commit, and the export must be boring: the exact shape
`Module.ts` declares, validated before it leaves the builder.

## What to change

- [ ] Serializer: draft → registry snippet. Ticket decides the format: JSON
      paste vs. generated-TS download (JSON is smaller; generated TS matches
      the handwritten registry shape exactly). Record the choice + reason.
- [ ] Pre-export validation in the builder: unknown surface ids, footprint
      overflow, radius past the geometry limit, empty statics — each fails
      with the same readable reason the server/publish path would give, so
      the author fixes it before committing, not after
- [ ] Paste-target docs: where the snippet goes (`modules.ts`), id
      uniqueness + naming convention, what to re-run (typecheck, affected
      suites) — a checklist, not prose
- [ ] Registry-side guard (cheap): a test asserting every registry entry
      passes the same validation the export runs — committed Modules can't
      rot past what the builder allows

## Done when

- [ ] A draft composed in ticket 04's mode exports, pastes/commits, and the
      Module places on a Draft with zero hand-editing — exercised live
- [ ] Each validation case fails in the builder with the server's own reason
      (spot-check two: bad surface id, footprint overflow)
- [ ] The format decision is recorded with its reason
- [ ] Paste-target docs followed verbatim by someone who didn't write them
      (the author counts, a week later counts double)

## Watch out for

**Don't build an import path.** Registry → draft (round-trip editing of
committed Modules) is a real feature and real scope — this ticket is
export-only; note it as a follow-up, don't half-build it.

**Don't smuggle in server-stored Modules.** Any "but what if the builder
just saved it to track-service" is the content-pipeline milestone wearing a
shortcut costume — explicitly out of M10.
