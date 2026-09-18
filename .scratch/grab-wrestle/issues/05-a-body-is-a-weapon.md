# 05 — A swung or hurled body is a weapon

**What to build:** A body swung by a Spin knocks into whoever it passes through, and a hurled body
into whoever it lands on. ADR 0104, "A swung or hurled body is a weapon".

**Blocked by:** 04

**Status:** done on tests (2026-09-18) — every live check is the user's

- [x] During a Spin, any other Character near the carried body takes an Impact scaled by the
      body's speed on the circle. A full Spin clears `IMPACT_RAGDOLL_MIN`. Resolved in `GrabHolds`
      with a query around the carry point each tick
- [x] After a Hurl, while the body is still flying, any Character it reaches takes an Impact scaled
      by its speed. This is a query of where the Ragdoll is, not a bone contact event, the same
      approach as `crashIntoCharacters` (ADR 0102)
- [x] Each pair counts once per pass (Spin) or per flight (Hurl), never once per tick of contact
      (ADR 0093's Bump lesson)
- [x] Knockdowns from either have cause `"Hurl"` (a Player caused them, so they throw)
- [x] Tests (shared): a slow Spin staggers and a full one knocks down; once per pass; a hurled body
      knocks down whoever it reaches and no one twice; the grabber and the Held Character are
      never their own targets
