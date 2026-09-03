# 01 — Mud: the first Surface that does something

**What to build:** A Track piece can be muddy, and standing on it visibly slows a Character down.
This is the tracer bullet for the whole Surface feature — it cuts a narrow path through every layer
the later Surface tickets widen: authoring a Surface on a Module, resolving it, finding it under a
Character at simulation time, and acting on it.

Mud is deliberately first rather than ice: capping top speed works on today's movement model, so
this ticket does not have to wait for the acceleration rewrite (ticket 05). Ice does have to wait,
because before velocity persists there is nothing for a grip scalar to multiply.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] A Module author can mark a whole Module, or one floor piece within it, as a given Surface —
      additive and optional, exactly like ADR 0034's `pitch`/`roll`
- [ ] The two levels collapse most-specific-first, once, at Track resolution — never in the tick
      loop, so no default-resolution logic runs 30 times a second on both client and server (ADR
      0036)
- [ ] The simulation can answer "what Surface is this Character standing on?" from the floor collider
      the character controller already reports, without a new scene query — a new query would depend
      on collider insertion order and break client/server determinism quietly rather than loudly
- [ ] Mud caps a Character's top speed while leaving its acceleration alone
- [ ] One demo Module, visually identical to existing floor pieces — the property is the deliverable,
      the look deliberately is not
- [ ] Every previously published Revision, the M1 seed included, loads and plays unchanged, with
      every Surface resolving to the default
- [ ] Unit tests for the collapse: a floor piece's own Surface wins over its Module's, a Module's wins
      over the default, and a Module with none anywhere is default throughout
- [ ] Manually verified live: walking onto the mud Module visibly slows the Character, walking off it
      restores full speed
