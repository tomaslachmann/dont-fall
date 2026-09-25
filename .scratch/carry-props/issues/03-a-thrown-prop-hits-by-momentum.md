# 03 — A thrown Prop hits by momentum

**What to build:** A tossed, Hurled or swung Prop knocks Characters down by the
Shooter ball's rule times `mass / PROJECTILE_MASS`, once per Character per flight
or pass, credited to the thrower. ADR 0125.

**Blocked by:** 02

**Status:** done on tests (2026-09-23)

- [x] A Prop flight: from the throw until it slows below `HURLED_BODY_MIN_SPEED` or
      `HURLED_BODY_FLIGHT_TICKS` runs out; nobody can pick it up in flight
- [x] Swing: a Spun Prop reaches whoever stands at its carry point, scaled by weight
- [x] Credit (ADR 0110): the knockout goes to the thrower, `"Hurl"`
- [x] Tests (shared): the same throw knocks down with a heavy Prop and only
      staggers or nudges with a cone; each Character once per flight; a shoved,
      rolling Prop still hurts nobody
