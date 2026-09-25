# 02 — Toss, Spin and Hurl a Prop

**What to build:** A tap of Hit tosses the carried Prop straight ahead. Holding
Hit Spins it and letting go Hurls it, aimed like a held Character. Both are
faster the lighter the Prop is. ADR 0125.

**Blocked by:** 01

**Status:** done on tests (2026-09-23)

- [x] `PROP_TOSS_TAP_TICKS`, `PROP_TOSS_SPEED`, `PROP_TOSS_LIFT`, `PROP_THROW_LIGHT/HEAVY`
- [x] Released within the tap window: a toss along the Spin's starting facing
- [x] Held longer: the Spin and Hurl of ADR 0104 (speed from the wind-up, the
      tangent pulled toward the steer), and dizzy past overspin
- [x] Tests (shared): a tap tosses forward; a Hurl leaves along the aimed tangent; a
      cone flies further than a ball; overspin flings it and puts the carrier down
