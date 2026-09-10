# 16 — Track discovery / browsing

**What to build:** Richer `track-service` listing metadata (ratings, play counts, author, best
time, filter categories) beyond today's flat `{id, name}` listing, needed by `Discover.tsx`.

**Blocked by:** nothing — independent of the account tickets (11–14) and can be picked up
whenever, per ADR 0052.

**Status:** scoped, ready to pick up.

## Decided scope (ADR 0052)

- **Browsing + category filters only** (e.g. Trending/Survival/Race/New-shaped tabs). Explicitly
  **not** in scope: ratings, author-name display, "best time." A lighter cut of `Discover.tsx`,
  not the full mock — those three specifically depend on identity/social data this ticket doesn't
  need.
- Play counts (to power "Trending"-style sorting) are in scope and don't need real accounts —
  an anonymous per-Track counter is enough.

## Why

Real Track listing today is a flat `{id, name}[]` (`TrackListing`, per
`docs/research/codebase-audit-m5.md` §3.3), consumed only by the host's Track picker inside the
Lobby (`LobbyScreen.tsx:59-72`). No matchmaking or browse endpoint exists in `apps/server/src`.
`Discover.tsx` assumes ratings, play counts, "best time," author name, and filter tabs
(Trending/Survival/Race/New) — a materially richer model than `track-service` provides today.

See `docs/research/test-components-design-screens-gap-analysis.md`, "Backend/domain gaps"
(Matchmaking/discovery entry) and screen row 1f.

## What to change

*(Deliberately unscoped — placeholder until ticket 04 confirms scope. Of the six backend tickets,
this one is the least entangled with accounts — play counts/ratings can be built without a real
account system if "author name" is dropped or deferred — so it could plausibly be the first of
the six picked up if the group wants an easy win.)*

## Done when

- [ ] Not yet scoped

## Watch out

- Don't start implementation from this ticket's current state. If picked up before accounts
  exist, explicitly drop author-name display rather than faking it against `DEFAULT_AUTHOR_ID`.
