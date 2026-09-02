# 03 — Match server fetches its Track from track-service

**What to build:** The Match server (`apps/server`) fetches a fully-resolved Track from
track-service at Round start (by ID, or "any") instead of importing hardcoded `PLAYGROUND_*`
constants, and assembles its authoritative simulation from the returned data. This is the
tracer-bullet checkpoint proving the whole new architecture end-to-end with zero player-visible
change: a live 2-browser session plays the same (still M1-identical) Track exactly as before, but
now sourced from the database via track-service instead of hardcoded imports.

**Blocked by:** 02 (track-service must exist and serve a real Track).

**Status:** ready-for-agent

- [ ] Match server calls track-service's fetch API at startup/Round start; no more direct
      `PLAYGROUND_STATICS`/`PLAYGROUND_PROPS`/`PLAYGROUND_SPINNERS` imports for the live Track
- [ ] The new runtime dependency (Match server requires track-service reachable to start a Round)
      is accepted per ADR 0028, not silently masked
- [ ] A live 2-browser playtest is behaviorally identical to the pre-refactor M1/M2 experience
- [ ] Existing server integration tests updated to fetch from (a test double / local instance of)
      track-service rather than the old constants
