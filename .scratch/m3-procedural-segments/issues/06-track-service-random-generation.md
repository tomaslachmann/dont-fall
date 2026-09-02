# 06 — track-service: random Track generation endpoint

**What to build:** A "generate a random Track" endpoint on track-service that picks and orders
Modules from the library at random (respecting the uniform footprint, ADR 0030) and persists the
result as an ordinary Track row — no different from a hand-built one at fetch time (ADR 0028): the
Match server and the builder never need to know how a given Track came to exist.

**Blocked by:** 01 (Module library to pick from), 02 (store + schema to persist into).

**Status:** ready-for-agent

- [ ] A generate endpoint assembles a valid, chainable sequence of Modules purely by construction
      (uniform footprint means no compatibility checking is needed)
- [ ] The generated Track is persisted exactly like a hand-built one — same schema, same fetch
      path, no "is this random?" flag needed by any consumer
- [ ] Repeated calls produce different valid Tracks
- [ ] A Track produced this way is fetchable by ID and (if ticket 03 is already done) runnable by
      the Match server with no special-casing
