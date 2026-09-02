# 06 — track-service: random Track generation endpoint

**What to build:** A "generate a random Track" endpoint on track-service that picks and orders
Modules from the library at random (respecting the uniform footprint, ADR 0030) and persists the
result as an ordinary Track row — no different from a hand-built one at fetch time (ADR 0028): the
Match server and the builder never need to know how a given Track came to exist.

**Blocked by:** 01 (Module library to pick from), 02 (store + schema to persist into).

**Status:** done

- [x] `POST /tracks/generate` (`generate.ts`'s `generateRandomTrack` + `chainTrack`) assembles a
      valid, chainable sequence of Modules purely by construction — no compatibility checking,
      per the uniform footprint (ADR 0030); optional `{ name, count }` body
- [x] The generated Track is persisted via the exact same `saveTrack` path a hand-built one uses —
      same schema, same `GET /tracks/:id` fetch, no "is this random?" flag anywhere (ADR 0028)
- [x] Repeated calls produce different valid Tracks (verified both live via curl and in a test
      asserting 5 parallel calls aren't all identical)
- [x] A Track produced this way is fetchable by ID with the identical shape a hand-built Track
      has — the Match server (ticket 03, already done) has zero branching on Track origin, so it
      is runnable with no special-casing by construction, not just by claim
- [x] 5 new tests (17 total in track-service); manually smoke-tested against a real running
      process with both default and custom `count`/`name`
