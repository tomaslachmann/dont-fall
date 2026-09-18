# 02 — The Struggle

**What to build:** A Held Character breaks free by wiggling: every reversal of its movement input
fills an escape meter, and a full meter before the window ends frees it on its feet. ADR 0104,
"The Struggle is wiggling, read off the movement input".

**Blocked by:** 01

**Status:** done on tests (2026-09-18) — every live check is the user's

- [x] A wiggle is a non-zero `moveDirection` roughly opposite (dot < −0.5) to the previous non-zero
      one. A→D→A, W→S and a gamepad stick waved side to side all count. Holding one key does not
- [x] Each wiggle adds `1 / GRAB_ESCAPE_WIGGLES`. The meter drains at `GRAB_ESCAPE_DECAY_PER_S`
      all the time — continuously, not after a pause, so no timer has to cross a reconcile
- [x] A full meter within `GRAB_STRUGGLE_WINDOW_MS` frees the Held Character on its feet, with a
      small shove away from the grabber (a shove, not a knockdown). The grabber's cooldown starts
- [x] Letting the window run out leaves the hold for ticket 03's Limp. Until 03 lands, it releases
      as ticket 01 does
- [x] The meter and the tick the window ends are on the snapshot (the anchor-tick idiom, as
      `phaseStartTick`). The meter is in `ReconcileBase`, predicted by the held client from its
      own inputs like `hitChargeMs`, so it answers a keypress at once. Breaking free stays the
      server's call
- [x] `GRAB_STRUGGLE_FREE_MS`, `GRAB_STRUGGLE_DOT_MIN` and the "walk away from the grabber" check
      retire
- [x] Tests (shared): alternating fills the meter and one held key does not; decay; breaking free
      on time; the window running out; a reconcile replay reproduces the meter; a wiggle across
      the reconcile boundary is counted once
