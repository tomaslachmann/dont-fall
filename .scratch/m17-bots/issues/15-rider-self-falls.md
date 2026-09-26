# 15 — The rider's two self-falls, and an invariant that holds it

**Design:** ADR 0129 (a Bot never steps off on its own) and ADR 0130's amendment (a script outranks
everything, so it must be safe on its own). **Evidence:** ticket 14, "As built (phase 3)", item 0, which
traced both Bot by Bot on the whole-Race seeds `races:base race:<level>`. The trace is `playSection`'s committed
`stepOffTrace` option (`harnessProbes.ts`), which reproduces the HARD one on `races:base race:hard`.

**Status:** planned. **Runs before 16–21:** until a script stops dropping its own Bot, no crowd
experiment can tell its Falls apart from these.

## The two

1. **HARD, bot-0, base race Cp 1→2 (the moving rows), Tick 1589.**
   - An `alighting` jump comes down 0.2 m under the still floor's level, on a bevel beside it, grounded
     but `Sliding`.
   - The rider's "down again but not on the floor it aimed for: for that floor" push (`deckRider.ts`,
     the `jumpHeading` branch) walks it +x.
   - The ground falls 4.65 → 2.8 over 15 Ticks, a 45° face, and it drops.
   - Fix at the source: a landing that reads `Sliding`, or ground below the aimed floor's level, never
     pushes along the face. It either climbs to the aimed floor by the shortest safe line, or stands and
     replans. Decide which from the geometry.
2. **NORMAL, bot-8, base race Cp 2→3 (the spinning squares), Tick 7348.**
   - An `aboard` walk to `aboardTarget` is steered live off a view 3–8 Ticks late.
   - The target (+z) and the rim push (−x) flip every few Ticks.
   - From t7337 the Bot walks +z for 7 Ticks while its seen position lags 1.0 m behind the real one. At
     t7344 it is past the rim, with its own rim check reading it 0.65 m inside.
   - Fix at the source: the walk aboard must keep a margin of at least what the Bot walks while its view
     lags plus one decision interval. Phase 3 found this as `deckMargin`; this is the rider's own
     version. The target and the rim push must not alternate either: one heading, re-aimed only on a
     fresh view.

## The invariant test (new, kept in the regression set)

A scripted `DeckRider` move never takes its own Bot past a deck's hull less the margin, or off valid
floor, when no other Character touches it. Test it:
- per state (waiting, boarding, aboard, alighting, landing);
- on the base race's rows and squares and on T1–T3;
- with perception delay 0–16 Ticks.

Its failure message names the state and the Tick.

## Targets

- Both traced Falls gone on their seeds.
- The whole-Race run's step-offs at 0 on the base race at every level, from 1 / 0 / 1 in ticket 14's
  last run.
- Passes on the rows and the squares no worse, on the section legs at the 07m seeds.

## Falsification

If step-offs stay the same after both fixes, the cause was not the committed script. Stop and trace
again.

## Files

`deckRider.ts`, a new `deckRider.invariant.test.ts` (or a section in `deckRider.test.ts`), and
`tuning/bots.ts` for any margin.

## Regression set

`deckRider`, `transfers`, `neverStepsOff`, `neverStranded`, `localMotion` and `sweeperHold`;
`apps/server`'s `bots` and `botFill`; both typechecks; the whole-Race run at the end.

Known reds that are not yours: the 14 in `RapierSimulation.test.ts`, the trapHold D/S wall-clock asserts, `difficulty.test.ts`, `races.test.ts`'s `ownFalls === 0`, `sweeperHold` base1's ordering, `deckRider`'s table-build times and the `think ≤ 40 µs` asserts under load (see ticket 14's As built lists).
