# 11 — Bots test the Tracks

**What to build:** the third job ADR 0129 gives a Bot. `pnpm bots:track <id> [--bots 12]
[--level normal] [--runs 5]` runs a Race headless with Motion running and prints a
report: finish rate, time spread, and Falls **per section and by cause** (an obstacle, a
knockdown or a Hurl, a trap, a badly timed jump). The authored Tracks' suites gain a Bot run beside
`walkTrack`.

**Blocked by:** 07, 09

**Status:** planned

- [ ] Section = between Checkpoints (the report names the Checkpoint pair)
- [ ] One authored Race's suite switches from waypoints to Bots. `walkTrack`'s lists are
      deleted only once each Track has a Bot suite proving the same (ADR 0129)
- [ ] MCP: a `playtest_draft` tool on the track-builder server, returning the same report
      for a draft, so an agent building a Track learns where people will fall
