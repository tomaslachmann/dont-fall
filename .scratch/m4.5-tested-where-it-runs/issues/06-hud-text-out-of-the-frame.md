# 06 — HUD text becomes a pure function

**What to build:** The HUD's text assembly moves out of the frame loop into a pure function of the
values it renders.

It is the least valuable ticket in the milestone and it is here for one reason: it is ~50 lines of
string building sitting in the middle of the loop ticket 02 is extracting, and it is the only part
of that loop with no netcode meaning at all. Moving it makes ticket 02's diff smaller and easier to
review.

**Blocked by:** None, but land it before 02 if 02 has not started.

**Status:** done

- [x] HUD text is a pure function from the values it displays to a string, with tests — `hudText.ts`,
      `formatHudText`
- [x] The frame loop calls it and sets it; the format is byte-identical to today's — the exact
      template string moved verbatim, pinned by a byte-for-byte test
- [x] ADR 0008 holds — the HUD stays plain DOM, drawn by the game
