# 01 — One rule for "this Character's input is locked"

**What to build:** The two mechanisms that lock a Character's input become one.

There are two today, at two layers. Qualification's lock lives **inside** the shared deterministic
step — a Qualified Character is fed idle input by `RapierSimulation.tick`. The phase lock lives
**outside** it, substituted independently by the server and again by the client. They were built a
ticket apart and neither is wrong; they simply answer the same question in two places.

Every Round type that changes who may move — eliminated-and-spectating, frozen while the floor
goes — lands on this fork. Unifying it first means the rest of M5 has one place to say "not this
Character, not this tick", instead of picking a side each time.

**Blocked by:** None — it is the foundation the rest of the milestone stands on.

**Status:** done

- [x] One rule, at one layer, answering "may this Character be driven this tick?" —
      `RapierSimulation.tick(inputs, phase)` ORs the Match-phase lock (`phaseLocksInput`) and the
      per-Character Qualification lock in exactly one place; every future Round type's own "who
      may move" rule (Survival's elimination, ticket 04) is one more OR term there, not a new
      mechanism. `matchLoop.ts` no longer pre-substitutes idle input before calling `tick` — it
      hands in the raw applied input and the phase it just decided
- [x] The client applies the identical rule to its own prediction, so both sides stop and start
      driving on the same Tick — the property M4 ticket 04's synchronous start depends on.
      `PredictionLoop.step`/`recordTick`/`reconcile` thread `phase` straight through to the same
      `RapierSimulation.tick`/`replayLocalCharacter` the server's own authority runs;
      `game/index.ts` samples real input unconditionally now and lets the shared step decide,
      rather than pre-substituting idle input itself. One separate, clearly-commented
      `phaseLocksInput` check remains for choosing an idle walk-animation stance while locked —
      cosmetic only, not a second enforcement mechanism
- [x] Every behaviour M4 verified live still holds: input locked in LOBBY and COUNTDOWN, released
      on the exact Tick RUNNING begins, locked again on Qualification and after the Round ends —
      covered by a new `RapierSimulation.test.ts` describe block (defaults to unlocked, locks
      every phase but RUNNING, releases on the exact Tick, locks again in ROUND_END, still locks a
      Qualified Character mid-RUNNING, and `replayLocalCharacter` applies the same lock) plus the
      full existing server/client suites passing unchanged — including the server's own "locks
      input until the Round is RUNNING — a Character cannot be walked off the start" test
- [x] Needs an ADR if it changes `RapierSimulation.tick`'s signature — ADR 0040 is extended, not
      superseded: **ADR 0044**
