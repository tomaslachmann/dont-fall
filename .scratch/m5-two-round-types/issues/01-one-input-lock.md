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

**Status:** ready-for-agent

- [ ] One rule, at one layer, answering "may this Character be driven this tick?"
- [ ] The client applies the identical rule to its own prediction, so both sides stop and start
      driving on the same Tick — the property M4 ticket 04's synchronous start depends on
- [ ] Every behaviour M4 verified live still holds: input locked in LOBBY and COUNTDOWN, released
      on the exact Tick RUNNING begins, locked again on Qualification and after the Round ends
- [ ] Needs an ADR if it changes `RapierSimulation.tick`'s signature — ADR 0040 is extended, not
      superseded
