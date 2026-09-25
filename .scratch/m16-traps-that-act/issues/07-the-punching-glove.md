# 07 — The punching glove

**What to build:** `DG_punching_glove` as a trap that hits: a wall box whose
glove shoots out on a clock or when somebody comes within reach, fast enough
that the ordinary Impact rule knocks them down. ADR 0121.

**Blocked by:** 01 (the converter), 02 (Parts), 03 (a Part on a clock)

**Status:** the timed half is done on tests (2026-09-21); the triggered mode is still open

- [x] The converter bakes the mitt at its bind pose and drops the skin, so the
      glove is a rigid `moving` Part like any other. It fails loudly if the
      export ever stops having exactly one skin to drop — silently baking the
      wrong pose is the failure this guards
- [x] `Puncher_Action_V14` is the punch; `V13` is dropped
- [x] The authored curve drives it (ADR 0116's rule): the glove's slide, the
      bellows' stretch and the scale that makes the glove appear are replayed
      from the clip's own samples, with the punch phase played at the def's
      speed so the glove crosses its 2.3 m at over 15 u/s
- [x] Collision follows the curve: no glove at rest, a glove while it is out —
      the same "solid only where the curve says" a trap door leaf has
- [x] A hit is an ordinary Impact (ADR 0037). Nothing says "always knock down":
      a glove slowed by its author only shoves, which is the gate doing its job
- [ ] Two modes, the author's pick (ADR 0121): a clock (period, phase, like a
      trap door) or a trigger — a Character within its reach, after a wind-up
      long enough to read. One PUNCH panel with the mode in it
- [ ] The trigger is a pure function of the world at a Tick, so both sides
      agree without it being sent; the wind-up is what makes it fair
- [x] Authoring: the builder's inspector and an MCP setter, and the builder
      previews the punch on its own clock
- [ ] Tests (shared): the glove is solid only while it is out; a punch knocks
      down and a slowed one does not; the timed mode repeats on its period; the
      triggered mode fires for a Character in reach and not for one outside it;
      two gloves with staggered phases punch in sequence

## Notes

- Measured from the export (2026-09-21): box 1.68 × 1.76 × ~1.2, the glove out
  to z = 3.18 from a rest of 0.87, punch 0.33–0.83 s, held to ~0.96 s,
  retracted by 1.5 s, cycle 1.83 s. Bellows scale y 0.1 → 2.1. The glove's own
  scale runs 0.001 → 1, which is what makes it appear.
- A re-export without the armature would retire the converter's one exception;
  the user chose the workaround for now (ADR 0121).

## As built

See ADR 0121's own "As built". In short: unbinding the skin was one line rather than a
bake, because Blender already writes those vertices in model space; every piece of the
authored motion survives, because the bone scales turn out to be plain node scales about
their own pivots; and `rate` (3×) is what lifts the fist past the knockdown threshold, so
the punch goes through the same rule as everything else.

**Still open — the triggered mode.** A punch that fires when a Character comes into reach
has to remember the Tick it started on, so its pose stops being a pure function of the
Tick, which is what every body in this milestone is. It wants the per-Segment replicated
state ADR 0118 built for the fragile floor, plus its own latch on the client — a piece of
work of its own rather than a branch inside this ticket. The timed mode ships first; the
PUNCH panel gains the mode switch with it.

**What the live check is for:** whether 3× reads as a punch or as a twitch, whether 3 s
between swings is right, and whether a fist that only exists while it is out is legible or
just startling.
